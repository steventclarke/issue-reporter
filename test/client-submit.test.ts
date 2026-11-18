import {
  createIssueReporter,
  createReportId,
  estimateBase64Bytes,
  getInstallationId,
  IssueReporterError,
  REDACTION_MARKER,
  SANITIZED_DATA_LIMIT_BYTES,
  type FetchInit,
  type FetchResponse,
  type IssueReporterConfig,
  type IssueReporterDiagnostic,
  type IssueReporterErrorCode,
  type IssueReporterErrorPart,
  type ReportSubmission,
} from '@steventclarke/issue-reporter-client';
import {
  cloneValidReportRequest,
  fixtureApp,
  fixtureEnvironment,
  fixtureInstallationId,
  fixtureReportId,
} from './fixtures/issue-report';

type MockFetch = jest.Mock<Promise<FetchResponse>, [string, FetchInit]>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const makeStorage = (initial?: string, key = 'issue-reporter/installation-id') => {
  const values = new Map<string, string>();
  if (initial) values.set(key, initial);
  return {
    values,
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => void values.set(key, value)),
  };
};

const mockFetch = (status: number, body: unknown): MockFetch =>
  jest.fn(async () => ({ status, json: async () => body })) as unknown as MockFetch;

const versionFetch = (apiMajor: number, apiVersion = `v${apiMajor}`): MockFetch =>
  jest.fn(async (_url: string, init: FetchInit) => {
    if (init.method === 'GET') {
      return { status: 200, json: async () => ({ apiMajor, apiVersion }) };
    }
    return { status: 202, json: async () => ({ reportId: fixtureReportId, status: 'queued' }) };
  }) as unknown as MockFetch;

const makeConfig = (overrides: Partial<IssueReporterConfig> = {}): IssueReporterConfig => ({
  endpoint: 'https://issues.example.test',
  app: fixtureApp,
  environment: fixtureEnvironment,
  storage: makeStorage(),
  fetch: mockFetch(202, { reportId: fixtureReportId, status: 'queued' }),
  skipApiVersionCheck: true,
  ...overrides,
});

const submission = (): ReportSubmission => {
  const request = cloneValidReportRequest();
  return {
    reportId: request.reportId,
    category: request.category,
    summary: request.summary,
    description: request.description,
    expected: request.expected,
    contact: request.contact,
    reporter: request.reporter,
    appData: request.appData,
    diagnostics: request.diagnostics,
    logs: request.logs,
    stackTraces: request.stackTraces,
    client: request.client,
    screenshot: request.screenshot,
    website: request.website,
  };
};

describe('createIssueReporter', () => {
  it('posts a redacted request with metadata and no credentials', async () => {
    const config = makeConfig();
    const input = submission();
    input.summary = `Token ghp_${'a'.repeat(36)}`;

    const result = await createIssueReporter(config).submit(input);

    expect(result).toEqual({ ok: true, reportId: fixtureReportId, status: 'queued' });
    const fetchMock = config.fetch as MockFetch;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://issues.example.test/v1/reports');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.signal).toBeDefined();

    const body = JSON.parse(init.body ?? '');
    expect(body.app).toBe(fixtureApp);
    expect(body.environment).toBe(fixtureEnvironment);
    expect(body.reportId).toBe(fixtureReportId);
    expect(body.installationId).toMatch(UUID_PATTERN);
    expect(body.summary).toContain(REDACTION_MARKER);
    expect(body.summary).not.toContain('ghp_');
    expect(init.body).not.toMatch(/authorization|cookie|credential/i);
  });

  it('checks the deployed API version once before posting', async () => {
    const fetch = versionFetch(1);
    const config = makeConfig({ fetch, skipApiVersionCheck: false });

    const result = await createIssueReporter(config).submit(submission());
    await createIssueReporter(config).submit(submission());

    expect(result.ok).toBe(true);
    const calls = fetch.mock.calls;
    expect(calls[0]![1].method).toBe('GET');
    expect(calls[0]![0]).toBe('https://issues.example.test/v1/version');
    expect(calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2);
  });

  it('rejects an API major mismatch before posting a report', async () => {
    const events: IssueReporterDiagnostic[] = [];
    const fetch = versionFetch(2);
    const config = makeConfig({
      fetch,
      skipApiVersionCheck: false,
      onDiagnostic: (event) => events.push(event),
    });

    const reporter = createIssueReporter(config);

    const first = await reporter.submit(submission());
    const second = await reporter.submit(submission());

    expect(first).toMatchObject({
      ok: false,
      error: { code: 'api_version_mismatch', apiMajor: 2, expectedApiMajor: 1 },
    });
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'api_version_mismatch' },
    });
    expect(fetch.mock.calls).toHaveLength(1);
    expect(events).toEqual([
      {
        event: 'api_version_mismatch',
        apiMajor: 2,
        expectedApiMajor: 1,
      },
    ]);
  });

  it('continues when the API version endpoint is unavailable', async () => {
    const fetch = jest.fn(async (_url: string, init: FetchInit) => {
      if (init.method === 'GET') return { status: 404, json: async () => ({}) };
      return { status: 202, json: async () => ({ reportId: fixtureReportId, status: 'queued' }) };
    }) as unknown as MockFetch;
    const config = makeConfig({ fetch, skipApiVersionCheck: false });

    const result = await createIssueReporter(config).submit(submission());

    expect(result.ok).toBe(true);
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST']);
  });

  it('adds the SSO bearer token as a header without putting it in the report', async () => {
    const token = 'sso-token-value';
    const events: IssueReporterDiagnostic[] = [];
    const config = makeConfig({
      auth: { getBearerToken: async () => token },
      onDiagnostic: (event) => events.push(event),
    });

    const result = await createIssueReporter(config).submit(submission());

    expect(result.ok).toBe(true);
    const [, init] = (config.fetch as MockFetch).mock.calls[0]!;
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    });
    expect(init.body).not.toContain(token);
    expect(events).toEqual([
      { event: 'auth_required', reportId: fixtureReportId },
      { event: 'request_started', reportId: fixtureReportId },
      { event: 'response_received', reportId: fixtureReportId, status: 202 },
    ]);
  });

  it('omits the header when no token is available and maps the 401 response', async () => {
    const events: IssueReporterDiagnostic[] = [];
    const config = makeConfig({
      auth: { getBearerToken: async () => null },
      fetch: mockFetch(401, { error: 'unauthorized', reason: 'missing_token' }),
      onDiagnostic: (event) => events.push(event),
    });

    const result = await createIssueReporter(config).submit(submission());

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unauthorized', status: 401, reason: 'missing_token' },
    });
    const [, init] = (config.fetch as MockFetch).mock.calls[0]!;
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(events).toEqual([
      { event: 'auth_required', reportId: fixtureReportId },
      { event: 'request_started', reportId: fixtureReportId },
      { event: 'response_received', reportId: fixtureReportId, status: 401 },
      {
        event: 'auth_failed',
        reportId: fixtureReportId,
        status: 401,
        reason: 'missing_token',
      },
    ]);
  });

  it('fails locally when the token provider throws', async () => {
    const events: IssueReporterDiagnostic[] = [];
    const config = makeConfig({
      auth: {
        getBearerToken: async () => {
          throw new Error('session unavailable');
        },
      },
      onDiagnostic: (event) => events.push(event),
    });

    const result = await createIssueReporter(config).submit(submission());

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unauthorized', reason: 'token_provider_failed' },
    });
    expect(config.fetch).not.toHaveBeenCalled();
    expect(events).toEqual([
      { event: 'auth_required', reportId: fixtureReportId },
      {
        event: 'auth_failed',
        reportId: fixtureReportId,
        reason: 'token_provider_failed',
      },
    ]);
  });

  it('generates a report id when the caller omits it', async () => {
    const config = makeConfig();
    const input = submission();
    delete input.reportId;

    const result = await createIssueReporter(config).submit(input);

    expect(result.ok).toBe(true);
    const [, init] = (config.fetch as MockFetch).mock.calls[0]!;
    expect(JSON.parse(init.body ?? '').reportId).toMatch(UUID_PATTERN);
  });

  it('applies tenant redaction patterns before sending', async () => {
    const config = makeConfig({ extraRedactionPatterns: [/tenant-ref-\d+/i] });
    const input = submission();
    input.description = 'A tenant-ref-123456 value was present in the app.';

    await createIssueReporter(config).submit(input);

    const [, init] = (config.fetch as MockFetch).mock.calls[0]!;
    expect(init.body).toContain(REDACTION_MARKER);
    expect(init.body).not.toContain('tenant-ref-123456');
  });

  it.each<[number, unknown, IssueReporterErrorCode | null]>([
    [202, { reportId: fixtureReportId, status: 'created' }, null],
    [400, { error: 'validation_failed', issues: [{ path: ['summary'] }] }, 'validation'],
    [401, { error: 'unauthorized', reason: 'missing_token' }, 'unauthorized'],
    [403, { error: 'forbidden', reason: 'not_allowed' }, 'forbidden'],
    [403, { error: 'forbidden_origin' }, 'forbidden_origin'],
    [405, { error: 'method_not_allowed' }, 'server'],
    [413, { error: 'payload_too_large' }, 'payload_too_large'],
    [429, { error: 'rate_limited', retryAfterSeconds: 60 }, 'rate_limited'],
    [500, { error: 'internal_error' }, 'server'],
    [503, { error: 'auth_unavailable', reason: 'auth_unavailable' }, 'auth_unavailable'],
  ])('maps HTTP %s', async (status, body, code) => {
    const result = await createIssueReporter(makeConfig({ fetch: mockFetch(status, body) })).submit(
      submission(),
    );

    if (code === null) {
      expect(result).toEqual({ ok: true, reportId: fixtureReportId, status: 'created' });
    } else {
      expect(result).toMatchObject({ ok: false, error: { code } });
    }
  });

  it('exposes retryAfterSeconds for rate limits', async () => {
    const result = await createIssueReporter(
      makeConfig({ fetch: mockFetch(429, { error: 'rate_limited', retryAfterSeconds: 90 }) }),
    ).submit(submission());

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', status: 429, retryAfterSeconds: 90 },
    });
  });

  it('maps an invalid response body to a server error', async () => {
    const fetch = jest.fn(async () => ({
      status: 202,
      json: async () => {
        throw new Error('bad json');
      },
    })) as unknown as MockFetch;

    const result = await createIssueReporter(makeConfig({ fetch })).submit(submission());

    expect(result).toMatchObject({ ok: false, error: { code: 'server', status: 202 } });
  });

  it('emits metadata-only diagnostic events', async () => {
    const events: IssueReporterDiagnostic[] = [];
    const config = makeConfig({
      fetch: mockFetch(429, { error: 'rate_limited', retryAfterSeconds: 60 }),
      onDiagnostic: (event) => events.push(event),
    });

    await createIssueReporter(config).submit(submission());

    expect(events).toEqual([
      { event: 'request_started', reportId: fixtureReportId },
      { event: 'response_received', reportId: fixtureReportId, status: 429 },
      {
        event: 'rate_limited',
        reportId: fixtureReportId,
        status: 429,
        retryAfterSeconds: 60,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('summary');
  });

  it('surfaces an aborted fetch as a network error', async () => {
    const fetch = jest.fn(
      (_url: string, init: FetchInit) =>
        new Promise<FetchResponse>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const result = await createIssueReporter(makeConfig({ fetch, timeoutMs: 1 })).submit(
      submission(),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it.each<[string, (input: ReportSubmission) => void, IssueReporterErrorPart]>([
    [
      'data',
      (input) => void (input.appData = { blob: 'x'.repeat(SANITIZED_DATA_LIMIT_BYTES + 1) }),
      'data',
    ],
    [
      'logs',
      (input) => {
        input.logs = Array.from({ length: 500 }, () => ({
          timestamp: '2026-11-14T17:52:03.120Z',
          level: 'log' as const,
          message: 'x'.repeat(600),
        }));
      },
      'logs',
    ],
    [
      'screenshot',
      (input) => {
        input.screenshot = { contentType: 'image/png', dataBase64: 'A'.repeat(4_200_000) };
      },
      'screenshot',
    ],
    [
      'request',
      (input) => {
        input.appData = { blob: 'x'.repeat(Math.floor(3.4 * 1024 * 1024)) };
        input.screenshot = {
          contentType: 'image/jpeg',
          dataBase64: 'A'.repeat(3_900_000),
        };
      },
      'request',
    ],
  ])('rejects oversized %s locally', async (_name, mutate, part) => {
    const config = makeConfig();
    const input = submission();
    mutate(input);

    const result = await createIssueReporter(config).submit(input);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'payload_too_large', part },
    });
    expect(config.fetch).not.toHaveBeenCalled();
  });

  it('returns a failure result with the report id when storage fails', async () => {
    const storage = {
      get: jest.fn(async () => {
        throw new Error('storage unavailable');
      }),
      set: jest.fn(async () => undefined),
    };

    const result = await createIssueReporter(makeConfig({ storage })).submit(submission());

    expect(result).toMatchObject({
      ok: false,
      reportId: fixtureReportId,
      error: { code: 'validation' },
    });
  });

  it('exposes the bound installation id helper', async () => {
    const storage = makeStorage(fixtureInstallationId);
    const reporter = createIssueReporter(makeConfig({ storage }));

    expect(await reporter.getInstallationId()).toBe(fixtureInstallationId);
    expect(storage.set).not.toHaveBeenCalled();
  });
});

describe('identifiers', () => {
  it('creates distinct UUID report ids', () => {
    const first = createReportId();
    const second = createReportId();

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(first).not.toBe(second);
  });

  it('reuses a stored installation id', async () => {
    const storage = makeStorage(fixtureInstallationId, 'custom-key');

    expect(await getInstallationId(storage, 'custom-key')).toBe(fixtureInstallationId);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('generates and stores an installation id when missing or invalid', async () => {
    const missing = makeStorage();
    const generated = await getInstallationId(missing, 'custom-key');
    expect(generated).toMatch(UUID_PATTERN);
    expect(missing.set).toHaveBeenCalledWith('custom-key', generated);

    const invalid = makeStorage('not-a-uuid', 'custom-key');
    const replacement = await getInstallationId(invalid, 'custom-key');
    expect(replacement).toMatch(UUID_PATTERN);
    expect(invalid.set).toHaveBeenCalledWith('custom-key', replacement);
  });
});

describe('estimateBase64Bytes', () => {
  it.each([
    ['', 0],
    ['YWJj', 3],
    ['YWI=', 2],
    ['data:image/png;base64,YWI=', 2],
  ])('estimates %s as %s bytes', (value, expected) => {
    expect(estimateBase64Bytes(value)).toBe(expected);
  });
});

describe('IssueReporterError', () => {
  it('retains safe metadata', () => {
    const error = new IssueReporterError('rate_limited', 'slow down', {
      status: 429,
      retryAfterSeconds: 60,
    });

    expect(error).toMatchObject({
      name: 'IssueReporterError',
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: 60,
    });
  });
});
