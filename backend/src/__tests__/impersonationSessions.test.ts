import request from 'supertest';
import app from '../index';
import { clearAdminAuditLogsForTests } from '../adminAudit';
import { clearImpersonationSessionsForTests } from '../impersonationSessionService';
import { registerApiKey } from '../middleware/apiKeyAuth';
import { normalizeWalletAddress } from '../walletUtils';

describe('Impersonation session ledger', () => {
  const superAdminApiKey = 'super-admin-impersonation-key';
  const adminApiKey = 'admin-impersonation-key';
  const targetWallet = normalizeWalletAddress(
    'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
  );
  const actingAdmin = 'GADMIN000000000000000000000000000000000000000000000001';

  beforeEach(() => {
    clearAdminAuditLogsForTests();
    clearImpersonationSessionsForTests();
    process.env.ADMIN_AUDIT_LOG_STORAGE = 'memory';
    process.env.IMPERSONATION_SESSION_STORAGE = 'memory';
    process.env.IMPERSONATION_SESSION_TTL_SECONDS = '900';
    registerApiKey(adminApiKey);
    registerApiKey(superAdminApiKey, { role: 'super-admin' });
  });

  async function startSession(reason = 'support investigation') {
    return request(app)
      .post('/admin/impersonate/sessions')
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', actingAdmin)
      .send({ targetWallet, reason });
  }

  it('creates an immutable session record with actor, reason, and expiry', async () => {
    const response = await startSession('customer support ticket #42');

    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({
      actor: actingAdmin,
      targetWallet,
      reason: 'customer support ticket #42',
      status: 'active',
    });
    expect(response.body.session.id).toBeTruthy();
    expect(response.body.session.expiresAt).toBeTruthy();
    expect(Date.parse(response.body.session.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('requires a valid session to impersonate a wallet', async () => {
    const sessionResponse = await startSession();
    const sessionId = sessionResponse.body.session.id;

    const response = await request(app)
      .get(`/admin/impersonate/${targetWallet}`)
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', actingAdmin)
      .set('x-impersonation-session-id', sessionId);

    expect(response.status).toBe(200);
    expect(response.body.walletAddress).toBe(targetWallet);
    expect(response.body.impersonationSession).toMatchObject({
      id: sessionId,
      reason: 'support investigation',
    });
  });

  it('rejects impersonation without a session header', async () => {
    const response = await request(app)
      .get(`/admin/impersonate/${targetWallet}`)
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', actingAdmin);

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/x-impersonation-session-id/i);
  });

  it('rejects expired sessions and requires a new session record', async () => {
    process.env.IMPERSONATION_SESSION_TTL_SECONDS = '1';

    const sessionResponse = await startSession();
    const sessionId = sessionResponse.body.session.id;

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const expiredResponse = await request(app)
      .get(`/admin/impersonate/${targetWallet}`)
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', actingAdmin)
      .set('x-impersonation-session-id', sessionId);

    expect(expiredResponse.status).toBe(403);
    expect(expiredResponse.body.message).toMatch(/expired/i);

    const endResponse = await request(app)
      .delete(`/admin/impersonate/sessions/${sessionId}`)
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', actingAdmin);

    expect(endResponse.status).toBe(404);

    const newSessionResponse = await startSession('renewed after expiry');
    expect(newSessionResponse.status).toBe(201);
    expect(newSessionResponse.body.session.id).not.toBe(sessionId);
  });

  it('lists active and historical sessions for super-admins', async () => {
    const sessionResponse = await startSession();
    const sessionId = sessionResponse.body.session.id;

    await request(app)
      .delete(`/admin/impersonate/sessions/${sessionId}`)
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', actingAdmin);

    const listResponse = await request(app)
      .get('/admin/impersonate/sessions')
      .query({ status: 'all', limit: 10 })
      .set('Authorization', `ApiKey ${superAdminApiKey}`)
      .set('x-admin-id', actingAdmin);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.count).toBeGreaterThanOrEqual(1);
    expect(listResponse.body.sessions[0]).toMatchObject({
      id: sessionId,
      actor: actingAdmin,
      targetWallet,
      reason: 'support investigation',
    });
  });

  it('denies non-super-admin session management', async () => {
    const response = await request(app)
      .post('/admin/impersonate/sessions')
      .set('Authorization', `ApiKey ${adminApiKey}`)
      .set('x-admin-id', actingAdmin)
      .send({ targetWallet, reason: 'should fail' });

    expect(response.status).toBe(403);
  });
});
