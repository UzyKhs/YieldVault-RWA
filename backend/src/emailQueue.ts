import { PrismaClient, EmailQueue } from '@prisma/client';
import { getPrismaClient } from './prismaClient';
import { emailService, EmailOptions } from './emailService';
import { logger } from './middleware/structuredLogging';

export class EmailQueueService {
  private prisma: PrismaClient;
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.prisma = getPrismaClient();
  }

  async enqueueEmail(options: EmailOptions): Promise<EmailQueue> {
    return this.prisma.emailQueue.create({
      data: {
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        status: 'pending',
        retryCount: 0,
        maxRetries: 5,
      },
    });
  }

  private calculateNextRetry(retryCount: number): Date {
    const delay = Math.min(1000 * Math.pow(2, retryCount), 60000); // Exponential backoff, max 60 seconds
    return new Date(Date.now() + delay);
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      const pendingEmails = await this.prisma.emailQueue.findMany({
        where: {
          status: {
            in: ['pending', 'failed'],
          },
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      for (const email of pendingEmails) {
        await this.processEmail(email);
      }
    } catch (error) {
      logger.log('error', 'Error processing email queue', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private async processEmail(email: EmailQueue): Promise<void> {
    try {
      await this.prisma.emailQueue.update({
        where: { id: email.id },
        data: { status: 'processing' },
      });

      const success = await emailService.sendEmailDirectly({
        to: email.to,
        subject: email.subject,
        text: email.text ?? '',
        html: email.html ?? '',
      });

      if (success) {
        await this.prisma.emailQueue.update({
          where: { id: email.id },
          data: { status: 'completed' },
        });
        logger.log('info', 'Email sent successfully from queue', { emailId: email.id });
      } else {
        await this.handleFailure(email, 'Email send failed');
      }
    } catch (error) {
      await this.handleFailure(email, error instanceof Error ? error.message : String(error));
    }
  }

  private async handleFailure(email: EmailQueue, errorMessage: string): Promise<void> {
    const newRetryCount = email.retryCount + 1;

    if (newRetryCount >= email.maxRetries) {
      await this.prisma.emailQueue.update({
        where: { id: email.id },
        data: {
          status: 'dead-letter',
          retryCount: newRetryCount,
          lastError: errorMessage,
        },
      });
      logger.log('error', 'Email moved to dead-letter', {
        emailId: email.id,
        error: errorMessage,
      });
    } else {
      const nextRetryAt = this.calculateNextRetry(newRetryCount);
      await this.prisma.emailQueue.update({
        where: { id: email.id },
        data: {
          status: 'failed',
          retryCount: newRetryCount,
          lastError: errorMessage,
          nextRetryAt,
        },
      });
      logger.log('warn', 'Email failed, will retry', {
        emailId: email.id,
        retryCount: newRetryCount,
        nextRetryAt,
      });
    }
  }

  async getEmailQueue(status?: string): Promise<EmailQueue[]> {
    const where = status ? { status } : {};
    return this.prisma.emailQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async replayEmail(emailId: string): Promise<EmailQueue> {
    await this.prisma.emailQueue.findUniqueOrThrow({
      where: { id: emailId },
    });

    return this.prisma.emailQueue.update({
      where: { id: emailId },
      data: {
        status: 'pending',
        retryCount: 0,
        lastError: null,
        nextRetryAt: null,
      },
    });
  }

  startWorker(intervalMs: number = 5000): void {
    if (this.processingInterval) return;
    this.processingInterval = setInterval(() => this.processQueue(), intervalMs);
    logger.log('info', 'Email queue worker started');
  }

  stopWorker(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.log('info', 'Email queue worker stopped');
    }
  }
}

export const emailQueueService = new EmailQueueService();
