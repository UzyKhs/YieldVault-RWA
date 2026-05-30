import {
  registerWebhookEndpoint,
  emitTransactionEvent,
  listWebhookDeadLetters,
  retryWebhookDeadLetter,
  resetWebhookState,
} from '../webhookDelivery';

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('Webhook dead-letter queue', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetWebhookState();
    process.env.WEBHOOK_MAX_ATTEMPTS = '1';
    process.env.WEBHOOK_ALLOW_UNVERIFIED = 'true';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stores exhausted deliveries in dead-letter storage', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const endpoint = registerWebhookEndpoint({ url: 'https://example.com/hook', enabled: true });

    await emitTransactionEvent('transaction.deposit.created', {
      transactionId: 'tx-dead-letter-1',
      amount: '50',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xdead',
      status: 'pending',
      timestamp: new Date().toISOString(),
    });

    await flushAsync();

    const deadLetters = listWebhookDeadLetters({ endpointId: endpoint.id });
    expect(deadLetters.length).toBeGreaterThanOrEqual(1);
    expect(deadLetters[0]).toMatchObject({
      endpointId: endpoint.id,
      eventType: 'transaction.deposit.created',
      status: 'dead-letter',
    });
  });

  it('re-queues dead-letter entries through normal delivery flow', async () => {
    let deliveryCalls = 0;
    global.fetch = jest.fn(async (_url, init) => {
      if (init?.body && String(init.body).includes('webhook.verification')) {
        const body = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ challenge: body.challenge }),
        } as Response;
      }

      deliveryCalls += 1;
      if (deliveryCalls === 1) {
        throw new Error('network down');
      }
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    const endpoint = registerWebhookEndpoint({ url: 'https://example.com/hook', enabled: true });

    await emitTransactionEvent('transaction.withdrawal.created', {
      transactionId: 'tx-retry-1',
      amount: '25',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xretry',
      status: 'pending',
      timestamp: new Date().toISOString(),
    });

    await flushAsync();
    const [deadLetter] = listWebhookDeadLetters({ endpointId: endpoint.id });
    expect(deadLetter).toBeTruthy();
    const initialAttempts = deadLetter.attempts;

    const retried = await retryWebhookDeadLetter(deadLetter.id);
    await flushAsync();

    expect(retried?.status).toBe('delivered');
    expect(retried?.attempts).toBeGreaterThan(initialAttempts);
  });
});
