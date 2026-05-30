import {
  registerWebhookEndpoint,
  verifyWebhookEndpoint,
  resetWebhookState,
  emitTransactionEvent,
} from '../webhookDelivery';

describe('Webhook endpoint verification handshake', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetWebhookState();
    process.env.WEBHOOK_ALLOW_UNVERIFIED = 'false';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('registers endpoints as pending verification and disabled by default', () => {
    const endpoint = registerWebhookEndpoint({ url: 'https://example.com/hook' });
    expect(endpoint.verificationStatus).toBe('pending');
    expect(endpoint.enabled).toBe(false);
  });

  it('marks endpoint verified when challenge is echoed correctly', async () => {
    let capturedChallenge = '';
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      capturedChallenge = body.challenge;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ challenge: body.challenge }),
      } as Response;
    }) as typeof fetch;

    const endpoint = registerWebhookEndpoint({ url: 'https://example.com/hook' });
    expect(capturedChallenge).toBeTruthy();

    const verified = await verifyWebhookEndpoint(endpoint.id);
    expect(verified?.verificationStatus).toBe('verified');
    expect(verified?.enabled).toBe(true);
    expect(verified?.verifiedAt).toBeTruthy();
  });

  it('does not deliver events to unverified endpoints by default', async () => {
    registerWebhookEndpoint({ url: 'https://example.com/hook' });
    const deliveredCount = await emitTransactionEvent('transaction.deposit.created', {
      transactionId: 'tx-1',
      amount: '100',
      asset: 'USDC',
      walletAddress: `G${'A'.repeat(55)}`,
      transactionHash: '0xabc',
      status: 'pending',
      timestamp: new Date().toISOString(),
    });

    expect(deliveredCount).toBe(0);
  });
});
