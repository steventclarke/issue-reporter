import {
  acceptedReportResponseSchema,
  apiVersionResponseSchema,
  appDataSchema,
  diagnosticsSchema,
  errorResponseSchema,
  issueReportRequestSchema,
  type IssueReportRequest,
} from '@steventclarke/issue-reporter-core';
import { cloneValidReportRequest } from './fixtures/issue-report';

type RequestMutator = (request: IssueReportRequest) => void;

describe('issueReportRequestSchema', () => {
  it('accepts the shared contract fixture', () => {
    expect(issueReportRequestSchema.safeParse(cloneValidReportRequest()).success).toBe(true);
  });

  it('accepts application-specific slugs and arbitrary JSON data', () => {
    const request = cloneValidReportRequest();
    request.app = 'iron-altar';
    request.environment = 'preview';
    request.category = 'enhancement';
    request.reporter!.provider = 'google';
    request.client.platform = 'web';
    request.appData = { any: { nested: [1, 'two', null] } };
    request.diagnostics = { customMetric: 7, tags: ['a', 'b'] };

    expect(issueReportRequestSchema.safeParse(request).success).toBe(true);
  });

  it('accepts fields at their maximum lengths', () => {
    const request = cloneValidReportRequest();
    request.summary = 's'.repeat(120);
    request.description = 'd'.repeat(5000);
    request.expected = 'e'.repeat(2000);
    request.contact = 'c'.repeat(200);

    expect(issueReportRequestSchema.safeParse(request).success).toBe(true);
  });

  it('accepts omitted automatic data and omitted optional fields', () => {
    const request = cloneValidReportRequest();
    request.reporter = undefined;
    request.appData = null;
    request.diagnostics = null;
    request.logs = null;
    request.stackTraces = null;
    request.screenshot = null;
    request.expected = undefined;
    request.contact = undefined;

    expect(issueReportRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each<[string, RequestMutator]>([
    ['invalid app slug', (request) => void (request.app = 'Not a slug!')],
    ['invalid environment slug', (request) => void (request.environment = 'Not an environment!')],
    ['invalid category slug', (request) => void (request.category = 'spam category')],
    [
      'invalid reporter provider slug',
      (request) => void (request.reporter!.provider = 'Google SSO'),
    ],
    ['invalid client platform slug', (request) => void (request.client.platform = 'Mobile')],
    ['invalid reportId', (request) => void (request.reportId = 'not-a-uuid')],
    ['short summary', (request) => void (request.summary = 'ab')],
    ['long summary', (request) => void (request.summary = 's'.repeat(121))],
    ['short description', (request) => void (request.description = 'too short')],
    ['long description', (request) => void (request.description = 'd'.repeat(5001))],
    ['long expected', (request) => void (request.expected = 'e'.repeat(2001))],
    ['long contact', (request) => void (request.contact = 'c'.repeat(201))],
    ['invalid reporter email', (request) => void (request.reporter!.email = 'not-an-email')],
    [
      'invalid log level',
      (request) => void ((request.logs![0] as { level: string }).level = 'trace'),
    ],
    ['invalid log timestamp', (request) => void (request.logs![0]!.timestamp = 'yesterday')],
    [
      'invalid screenshot content type',
      (request) => void ((request.screenshot as { contentType: string }).contentType = 'image/gif'),
    ],
    [
      'invalid screenshot base64',
      (request) => void (request.screenshot!.dataBase64 = 'not base64!'),
    ],
    [
      'too many logs',
      (request) => {
        const entry = request.logs![0]!;
        request.logs = Array.from({ length: 501 }, () => entry);
      },
    ],
    [
      'too many stack traces',
      (request) => {
        const entry = request.stackTraces![0]!;
        request.stackTraces = Array.from({ length: 11 }, () => entry);
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const request = cloneValidReportRequest();
    mutate(request);

    expect(issueReportRequestSchema.safeParse(request).success).toBe(false);
  });

  it('strips unknown root keys while preserving tenant JSON data', () => {
    const base = cloneValidReportRequest();
    const request = {
      ...base,
      unexpectedRoot: 'drop',
      appData: { ...(base.appData as Record<string, unknown>), unexpectedAppData: 'kept' },
      diagnostics: { ...base.diagnostics!, unexpectedDiagnostics: 'kept' },
    };

    const parsed = issueReportRequestSchema.parse(request);

    expect(parsed).not.toHaveProperty('unexpectedRoot');
    expect(parsed.appData).toHaveProperty('unexpectedAppData');
    expect(parsed.diagnostics).toHaveProperty('unexpectedDiagnostics');
  });

  it('validates generic JSON and log/stack-trace shapes independently', () => {
    const request = cloneValidReportRequest();

    expect(appDataSchema.safeParse(request.appData).success).toBe(true);
    expect(appDataSchema.safeParse(new Date()).success).toBe(false);
    expect(diagnosticsSchema.safeParse({ arbitrary: [1, 'two', null] }).success).toBe(true);
    expect(
      issueReportRequestSchema.shape.logs.safeParse([{ timestamp: 'yesterday', level: 'log' }])
        .success,
    ).toBe(false);
    expect(
      issueReportRequestSchema.shape.stackTraces.safeParse([
        {
          timestamp: '2026-11-14T17:52:03.121Z',
          message: 'error',
          stack: 'at x',
          isFatal: false,
        },
      ]).success,
    ).toBe(true);
  });
});

describe('response schemas', () => {
  it('accepts only well-formed API version responses', () => {
    expect(apiVersionResponseSchema.safeParse({ apiMajor: 1, apiVersion: 'v1' }).success).toBe(
      true,
    );
    expect(apiVersionResponseSchema.safeParse({ apiMajor: 0, apiVersion: 'v1' }).success).toBe(
      false,
    );
    expect(apiVersionResponseSchema.safeParse({ apiMajor: 1, apiVersion: 'one' }).success).toBe(
      false,
    );
  });

  it.each(['receiving', 'queued', 'created'] as const)('accepts %s status', (status) => {
    expect(
      acceptedReportResponseSchema.safeParse({
        reportId: cloneValidReportRequest().reportId,
        status,
      }).success,
    ).toBe(true);
  });

  it('rejects a failed status in an accepted response', () => {
    expect(
      acceptedReportResponseSchema.safeParse({
        reportId: cloneValidReportRequest().reportId,
        status: 'failed',
      }).success,
    ).toBe(false);
  });

  it('accepts documented error bodies with metadata only', () => {
    expect(
      errorResponseSchema.safeParse({ error: 'rate_limited', retryAfterSeconds: 3600 }).success,
    ).toBe(true);
    expect(errorResponseSchema.safeParse({ error: 'validation_failed', issues: [] }).success).toBe(
      true,
    );
    expect(
      errorResponseSchema.safeParse({ error: 'unauthorized', reason: 'missing_token' }).success,
    ).toBe(true);
    expect(
      errorResponseSchema.safeParse({ error: 'forbidden', reason: 'not_allowed' }).success,
    ).toBe(true);
    expect(
      errorResponseSchema.safeParse({ error: 'auth_unavailable', reason: 'auth_unavailable' })
        .success,
    ).toBe(true);
    expect(errorResponseSchema.safeParse({ error: 'unknown_error' }).success).toBe(false);
    expect(
      errorResponseSchema.safeParse({ error: 'unauthorized', reason: 'raw_jwt' }).success,
    ).toBe(false);
  });
});
