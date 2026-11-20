import { FetchError, JwtExpiredError } from 'aws-jwt-verify/error';
import {
  API_MAJOR,
  API_VERSION,
  REQUEST_BODY_LIMIT_BYTES,
} from '@stevenclarke/issue-reporter-core';
import * as sanitizeModule from '../../src/ingest/sanitize';
import type { IssueIntakeAuthConfig } from '../../config/applications';
import { createIngestHandler } from '../../src/ingest/handler';
import type { ReportRecord, VerifiedClaims } from '../../src/ingest/types';
import { cloneValidReportRequest, secretBearingReportRequest } from '../fixtures/issue-report';
import { makeDependencies, makeEvent, responseJson, testApplications, testOrigin } from './helpers';

const oidcAuth: Extract<IssueIntakeAuthConfig, { mode: 'oidc' }> = {
  mode: 'oidc',
  issuer: 'https://issuer.example.com',
  audience: 'client-id',
  tokenUse: 'id',
  allowedGroups: ['issue-reporter-beta'],
};

const oidcApplications = [
  {
    ...testApplications[0]!,
    issueIntake: { ...testApplications[0]!.issueIntake!, auth: oidcAuth },
  },
];

const verifiedClaims: VerifiedClaims = {
  subject: 'user-123',
  email: 'user@example.com',
  emailVerified: true,
  name: 'User',
  groups: ['issue-reporter-beta'],
};

const storedReport = (putObject: { mock: { calls: unknown[][] } }): Record<string, unknown> => {
  const body = putObject.mock.calls[0]?.[1] as Uint8Array;
  return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
};

afterEach(() => jest.restoreAllMocks());

describe('request gate', () => {
  it('rejects missing or unknown origins without CORS headers', async () => {
    const { dependencies } = makeDependencies();
    const handler = createIngestHandler(dependencies);

    const missing = await handler(makeEvent({}, { headers: {} }));
    expect(missing.statusCode).toBe(403);
    expect(responseJson(missing)).toEqual({ error: 'forbidden_origin' });
    expect(missing.headers['access-control-allow-origin']).toBeUndefined();

    const unknown = await handler(makeEvent({}, { headers: { origin: 'https://evil.example' } }));
    expect(unknown.statusCode).toBe(403);
    expect(responseJson(unknown)).toEqual({ error: 'forbidden_origin' });
  });

  it('handles preflight and version requests before method checks', async () => {
    const { dependencies } = makeDependencies();
    const handler = createIngestHandler(dependencies);

    const preflight = await handler(
      makeEvent({}, { rawPath: '/anything', requestContext: { http: { method: 'OPTIONS' } } }),
    );
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(testOrigin);

    const version = await handler(
      makeEvent({}, { rawPath: '/v1/version', requestContext: { http: { method: 'GET' } } }),
    );
    expect(version.statusCode).toBe(200);
    expect(responseJson(version)).toEqual({ apiMajor: API_MAJOR, apiVersion: API_VERSION });
  });

  it('rejects unsupported methods and paths', async () => {
    const { dependencies } = makeDependencies();
    const handler = createIngestHandler(dependencies);

    const response = await handler(
      makeEvent({}, { rawPath: '/v1/reports', requestContext: { http: { method: 'DELETE' } } }),
    );
    expect(response.statusCode).toBe(405);
    expect(responseJson(response)).toEqual({ error: 'method_not_allowed' });
  });
});

describe('body and contract validation', () => {
  it('enforces the raw body limit before parsing', async () => {
    const { dependencies } = makeDependencies();
    const handler = createIngestHandler(dependencies);
    const response = await handler(
      makeEvent({}, { body: 'x'.repeat(REQUEST_BODY_LIMIT_BYTES + 1) }),
    );

    expect(response.statusCode).toBe(413);
    expect(responseJson(response)).toEqual({ error: 'payload_too_large' });
  });

  it('rejects invalid JSON and invalid fields without raw values', async () => {
    const { dependencies, store } = makeDependencies();
    const handler = createIngestHandler(dependencies);

    const invalidJson = await handler(makeEvent({}, { body: '{' }));
    expect(invalidJson.statusCode).toBe(400);
    expect(responseJson(invalidJson).error).toBe('validation_failed');

    const request = cloneValidReportRequest();
    request.summary = 'x';
    const invalidField = await handler(makeEvent(request));
    expect(invalidField.statusCode).toBe(400);
    expect(responseJson(invalidField).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['summary'] })]),
    );
    expect(store.getReport).not.toHaveBeenCalled();
  });

  it('strips unknown request-envelope keys', async () => {
    const { dependencies, objects } = makeDependencies();
    const handler = createIngestHandler(dependencies);
    const request = { ...cloneValidReportRequest(), unknownField: 'strip-me' };

    const response = await handler(makeEvent(request));

    expect(response.statusCode).toBe(202);
    expect(JSON.stringify(storedReport(objects.putObject))).not.toContain('strip-me');
  });

  it('rejects unknown apps and disallowed tenant values', async () => {
    const { dependencies } = makeDependencies();
    const handler = createIngestHandler(dependencies);

    const unknownApp = cloneValidReportRequest();
    unknownApp.app = 'other-app';
    expect(responseJson(await handler(makeEvent(unknownApp))).error).toBe('validation_failed');

    const badEnvironment = cloneValidReportRequest();
    badEnvironment.environment = 'staging';
    expect(responseJson(await handler(makeEvent(badEnvironment))).issues).toEqual([
      expect.objectContaining({ path: 'environment' }),
    ]);

    const badCategory = cloneValidReportRequest();
    (badCategory as { category: string }).category = 'spam';
    expect(responseJson(await handler(makeEvent(badCategory))).issues).toEqual([
      expect.objectContaining({ path: ['category'] }),
    ]);

    const badReporter = cloneValidReportRequest();
    badReporter.reporter!.provider = 'other-sso';
    expect(responseJson(await handler(makeEvent(badReporter))).issues).toEqual([
      expect.objectContaining({ path: 'reporter.provider' }),
    ]);
  });
});

describe('OIDC authentication', () => {
  const authEvent = (authorization?: string) => {
    const base = makeEvent(cloneValidReportRequest(), { headers: { origin: testOrigin } });
    return { ...base, headers: { ...base.headers, ...(authorization ? { authorization } : {}) } };
  };

  it('returns metadata-only auth failures and performs no side effects', async () => {
    const { dependencies, store, verifier, logger } = makeDependencies({
      applications: oidcApplications,
    });
    const handler = createIngestHandler(dependencies);

    const missing = await handler(authEvent());
    expect(missing.statusCode).toBe(401);
    expect(responseJson(missing)).toEqual({ error: 'unauthorized', reason: 'missing_token' });

    verifier.verify.mockRejectedValueOnce(new JwtExpiredError('expired', undefined));
    const expired = await handler(authEvent('Bearer expired-token'));
    expect(expired.statusCode).toBe(401);
    expect(responseJson(expired)).toEqual({ error: 'unauthorized', reason: 'expired_token' });

    verifier.verify.mockRejectedValueOnce(
      new FetchError('https://issuer.example.com/.well-known/jwks.json', 'down'),
    );
    const unavailable = await handler(authEvent('Bearer token'));
    expect(unavailable.statusCode).toBe(503);
    expect(responseJson(unavailable)).toEqual({
      error: 'auth_unavailable',
      reason: 'auth_unavailable',
    });

    verifier.verify.mockResolvedValueOnce({ ...verifiedClaims, groups: [] });
    const denied = await handler(authEvent('Bearer token'));
    expect(denied.statusCode).toBe(403);
    expect(responseJson(denied)).toEqual({ error: 'forbidden', reason: 'not_allowed' });

    expect(store.getReport).not.toHaveBeenCalled();
    expect(store.consumeRateLimit).not.toHaveBeenCalled();
    const logged = JSON.stringify(logger.mock.calls);
    expect(logged).not.toContain('expired-token');
    expect(logged).not.toContain('user@example.com');
    expect(logged).toContain('authReason');
  });

  it('overwrites reporter from verified claims and rate-limits the subject', async () => {
    const { dependencies, store, objects, verifierFactory } = makeDependencies({
      applications: oidcApplications,
    });
    const handler = createIngestHandler(dependencies);
    const request = cloneValidReportRequest();
    request.reporter = { provider: 'untrusted', subject: 'attacker' };

    const response = await handler(authEventWithRequest(request, 'Bearer token'));

    expect(response.statusCode).toBe(202);
    expect(storedReport(objects.putObject).reporter).toEqual({
      provider: 'example-sso',
      subject: 'user-123',
      email: 'user@example.com',
      name: 'User',
    });
    expect(verifierFactory).toHaveBeenCalledWith(oidcAuth);
    expect(store.consumeRateLimit).toHaveBeenCalledWith('subject', 'user-123', 5);
  });

  it('does not require a token for preflight requests', async () => {
    const { dependencies } = makeDependencies({ applications: oidcApplications });
    const handler = createIngestHandler(dependencies);
    const event = makeEvent({}, { requestContext: { http: { method: 'OPTIONS' } } });

    expect((await handler(event)).statusCode).toBe(204);
  });
});

const authEventWithRequest = (
  request: ReturnType<typeof cloneValidReportRequest>,
  token: string,
) => {
  const base = makeEvent(request, { headers: { origin: testOrigin } });
  return { ...base, headers: { ...base.headers, authorization: token } };
};

describe('honeypot and idempotency', () => {
  it('acknowledges honeypot submissions without writes', async () => {
    const { dependencies, store, objects, queue, metrics } = makeDependencies();
    const handler = createIngestHandler(dependencies);
    const request = cloneValidReportRequest();
    request.website = 'bot-filled-this';

    const response = await handler(makeEvent(request));

    expect(response.statusCode).toBe(202);
    expect(responseJson(response)).toEqual({ reportId: request.reportId, status: 'queued' });
    expect(metrics.increment).toHaveBeenCalledWith('honeypot_triggered');
    expect(store.getReport).not.toHaveBeenCalled();
    expect(objects.putObject).not.toHaveBeenCalled();
    expect(queue.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['receiving', 'receiving'],
    ['queued', 'queued'],
    ['created', 'created'],
    ['failed', 'queued'],
  ] as const)('returns the current status for an existing %s report', async (status, expected) => {
    const { dependencies, store, objects, queue } = makeDependencies();
    store.getReport.mockResolvedValueOnce({ status } as ReportRecord);
    const handler = createIngestHandler(dependencies);

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(202);
    expect(responseJson(response)).toEqual({ reportId: expect.any(String), status: expected });
    expect(store.consumeRateLimit).not.toHaveBeenCalled();
    expect(objects.putObject).not.toHaveBeenCalled();
    expect(queue.sendMessage).not.toHaveBeenCalled();
  });
});

describe('rate limits', () => {
  it('returns 429 with retryAfterSeconds and no writes', async () => {
    const { dependencies, store, objects } = makeDependencies();
    store.consumeRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 123 });
    const handler = createIngestHandler(dependencies);

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(429);
    expect(responseJson(response)).toEqual({ error: 'rate_limited', retryAfterSeconds: 123 });
    expect(objects.putObject).not.toHaveBeenCalled();
  });

  it('hashes viewer IPs and applies install, ip, and app limits', async () => {
    const { dependencies, store, logger } = makeDependencies();
    const handler = createIngestHandler(dependencies);
    const event = makeEvent(cloneValidReportRequest(), {
      headers: { origin: testOrigin, 'cloudfront-viewer-address': '203.0.113.9:5555' },
    });

    await handler(event);

    expect(store.consumeRateLimit).toHaveBeenCalledWith('install', expect.any(String), 5);
    expect(store.consumeRateLimit).toHaveBeenCalledWith(
      'ip',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      10,
    );
    expect(store.consumeRateLimit).toHaveBeenCalledWith('app', 'example-app', 20);
    expect(JSON.stringify(logger.mock.calls)).not.toContain('203.0.113.9');
  });
});

describe('persistence', () => {
  it('redacts secrets before storing report.json and logs only metadata', async () => {
    const { dependencies, objects, logger } = makeDependencies();
    const handler = createIngestHandler(dependencies);

    const response = await handler(makeEvent(secretBearingReportRequest()));
    const stored = JSON.stringify(storedReport(objects.putObject));
    const logged = JSON.stringify(logger.mock.calls);

    expect(response.statusCode).toBe(202);
    expect(stored).not.toContain('ghp_');
    expect(stored).not.toContain('AKIA');
    expect(stored).not.toContain('dataBase64');
    expect(logged).not.toContain('ghp_');
    expect(logged).not.toContain('AKIA');
    expect(logger).toHaveBeenCalledWith({
      app: 'example-app',
      reportId: expect.any(String),
      status: 'queued',
    });
  });

  it('stores report.json and screenshot at the documented keys and enqueues once', async () => {
    const { dependencies, store, objects, queue } = makeDependencies();
    const handler = createIngestHandler(dependencies);
    const request = cloneValidReportRequest();

    const response = await handler(makeEvent(request));

    expect(response.statusCode).toBe(202);
    expect(objects.putObject).toHaveBeenNthCalledWith(
      1,
      `attachments/reports/example-app/${request.reportId}/report.json`,
      expect.any(Uint8Array),
      'application/json',
    );
    expect(objects.putObject).toHaveBeenNthCalledWith(
      2,
      `attachments/reports/example-app/${request.reportId}/screenshot.jpg`,
      expect.any(Uint8Array),
      'image/jpeg',
    );
    expect(store.putReceiving).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'receiving', reportKey: expect.any(String) }),
    );
    expect(store.updateQueued).toHaveBeenCalledWith(request.reportId, {
      reportKey: `attachments/reports/example-app/${request.reportId}/report.json`,
      screenshotKey: `attachments/reports/example-app/${request.reportId}/screenshot.jpg`,
    });
    expect(queue.sendMessage).toHaveBeenCalledTimes(1);
    expect(queue.sendMessage).toHaveBeenCalledWith({
      reportId: request.reportId,
      app: 'example-app',
      environment: 'production',
    });
  });

  it('omits screenshot objects when no screenshot is present', async () => {
    const { dependencies, objects, store } = makeDependencies();
    const handler = createIngestHandler(dependencies);
    const request = cloneValidReportRequest();
    request.screenshot = null;

    await handler(makeEvent(request));

    expect(objects.putObject).toHaveBeenCalledTimes(1);
    expect(store.updateQueued).toHaveBeenCalledWith(request.reportId, {
      reportKey: expect.any(String),
      screenshotKey: undefined,
    });
  });

  it('rejects oversized sanitized data before any writes', async () => {
    const { dependencies, store, objects } = makeDependencies();
    const handler = createIngestHandler(dependencies);
    const request = cloneValidReportRequest();
    request.appData = 'x'.repeat(4 * 1024 * 1024);

    const response = await handler(makeEvent(request));

    expect(response.statusCode).toBe(413);
    expect(store.putReceiving).not.toHaveBeenCalled();
    expect(objects.putObject).not.toHaveBeenCalled();
  });

  it('returns 500 for unexpected redaction errors before any writes', async () => {
    const { dependencies, store, objects } = makeDependencies();
    jest.spyOn(sanitizeModule, 'sanitizeReport').mockImplementation(() => {
      throw new Error('redaction crashed');
    });
    const handler = createIngestHandler(dependencies);

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(500);
    expect(responseJson(response)).toEqual({ error: 'internal_error' });
    expect(store.putReceiving).not.toHaveBeenCalled();
    expect(objects.putObject).not.toHaveBeenCalled();
  });

  it('returns the existing status when the conditional write loses a race', async () => {
    const { dependencies, store, objects, queue } = makeDependencies();
    store.putReceiving.mockResolvedValueOnce({
      ok: false,
      existing: { status: 'created' } as ReportRecord,
    });
    const handler = createIngestHandler(dependencies);

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(202);
    expect(responseJson(response).status).toBe('created');
    expect(objects.putObject).not.toHaveBeenCalled();
    expect(queue.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['upload', 'queue'] as const)(
    'rolls back the record and objects on %s failure',
    async (failure) => {
      const { dependencies, store, objects, queue } = makeDependencies();
      if (failure === 'upload') {
        objects.putObject.mockRejectedValueOnce(new Error('upload failed'));
      } else {
        queue.sendMessage.mockRejectedValueOnce(new Error('queue failed'));
      }
      const handler = createIngestHandler(dependencies);
      const request = cloneValidReportRequest();

      const response = await handler(makeEvent(request));

      expect(response.statusCode).toBe(500);
      expect(responseJson(response)).toEqual({ error: 'internal_error' });
      expect(store.deleteReport).toHaveBeenCalledWith(request.reportId);
      expect(objects.deleteObject).toHaveBeenCalledWith(
        `attachments/reports/example-app/${request.reportId}/report.json`,
      );
      expect(objects.deleteObject).toHaveBeenCalledWith(
        `attachments/reports/example-app/${request.reportId}/screenshot.jpg`,
      );
      expect(queue.sendMessage).toHaveBeenCalledTimes(failure === 'queue' ? 1 : 0);
    },
  );
});
