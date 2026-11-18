import {
  installationStorageKey,
  IssueReporterError,
  normalizeStorageKeyPrefix,
  validateConfig,
  type IssueReporterConfig,
} from '@stevenclarke/issue-reporter-client';
import { fixtureApp, fixtureEnvironment } from './fixtures/issue-report';

const storage = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
};

const baseConfig = (): IssueReporterConfig => ({
  endpoint: 'https://issues.example.test/',
  app: fixtureApp,
  environment: fixtureEnvironment,
  storage,
  fetch: jest.fn(async () => ({ status: 202, json: async () => ({}) })),
});

describe('validateConfig', () => {
  it('normalizes the endpoint and applies defaults', () => {
    const resolved = validateConfig(baseConfig());

    expect(resolved.endpoint).toBe('https://issues.example.test');
    expect(resolved.timeoutMs).toBe(30_000);
    expect(resolved.installationKey).toBe('issue-reporter/installation-id');
    expect(resolved.extraRedactionPatterns).toEqual([]);
    expect(resolved.auth).toBeUndefined();
    expect(resolved.skipApiVersionCheck).toBeUndefined();
  });

  it('uses a configured storage prefix', () => {
    const resolved = validateConfig({ ...baseConfig(), storageKeyPrefix: 'iron-altar' });

    expect(resolved.installationKey).toBe('iron-altar/installation-id');
  });

  it('accepts an SSO bearer token provider', () => {
    const getBearerToken = jest.fn(async () => 'token');
    const resolved = validateConfig({ ...baseConfig(), auth: { getBearerToken } });

    expect(resolved.auth?.getBearerToken).toBe(getBearerToken);
  });

  it.each<[string, (config: IssueReporterConfig) => void]>([
    ['invalid endpoint', (config) => void (config.endpoint = 'not a url')],
    ['unsupported endpoint protocol', (config) => void (config.endpoint = 'ftp://example.test')],
    ['endpoint query', (config) => void (config.endpoint = 'https://example.test?x=1')],
    ['invalid app', (config) => void (config.app = 'Not a slug!')],
    ['invalid environment', (config) => void (config.environment = 'Not valid!')],
    ['missing storage', (config) => void (config.storage = {} as IssueReporterConfig['storage'])],
    ['zero timeout', (config) => void (config.timeoutMs = 0)],
    [
      'invalid API version check opt-out',
      (config) => void (config.skipApiVersionCheck = 'yes' as unknown as boolean),
    ],
    [
      'invalid redaction patterns',
      (config) => void (config.extraRedactionPatterns = [1 as unknown as RegExp]),
    ],
    [
      'invalid auth provider',
      (config) => void (config.auth = {} as unknown as IssueReporterConfig['auth']),
    ],
    [
      'invalid diagnostic callback',
      (config) =>
        void (config.onDiagnostic = 'no' as unknown as IssueReporterConfig['onDiagnostic']),
    ],
  ])('rejects %s', (_name, mutate) => {
    const config = baseConfig();
    mutate(config);

    expect(() => validateConfig(config)).toThrow(IssueReporterError);
    expect(() => validateConfig(config)).toThrow(
      /endpoint|app|environment|storage|timeoutMs|version|auth|Redaction|diagnostic/i,
    );
  });
});

describe('storage keys', () => {
  it.each([
    [undefined, 'issue-reporter/'],
    ['iron-altar', 'iron-altar/'],
    ['iron-altar/', 'iron-altar/'],
  ])('normalizes %s to %s', (prefix, expected) => {
    expect(normalizeStorageKeyPrefix(prefix)).toBe(expected);
    expect(installationStorageKey(prefix)).toBe(`${expected}installation-id`);
  });
});
