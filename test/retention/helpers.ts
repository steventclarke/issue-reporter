import type {
  AttachmentStore,
  RetentionDependencies,
  RetentionReportRecord,
  RetentionStore,
  SecretStore,
} from '../../src/retention/types';
import type { GithubAppSecret, GithubClientFactory, IssueClient } from '../../src/worker/types';

export const reportId = '8c8f1f4e-8d6d-4f7f-9d7a-1d1d5e9d1234';

export const githubSecret: GithubAppSecret = {
  appId: 123456,
  installationId: 654321,
  privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
};

export const createdReport: RetentionReportRecord = {
  pk: `REPORT#${reportId}`,
  sk: 'META',
  app: 'iron-altar',
  environment: 'prod',
  status: 'created',
  installationId: 'b0f5de9b-4f5b-4c6f-9a1c-9a5b8a4e1f10',
  category: 'bug',
  reportKey: `attachments/reports/iron-altar/${reportId}/report.json`,
  screenshotKey: `attachments/reports/iron-altar/${reportId}/screenshot.jpg`,
  createdAt: '2026-01-02T03:00:00.000Z',
  updatedAt: '2026-01-02T03:01:00.000Z',
  subject: 'cognito-sub-123',
  issueNumber: 42,
  issueUrl: 'https://github.com/steventclarke/iron-altar/issues/42',
};

export const appConfigs = [
  {
    name: 'iron-altar',
    repo: 'steventclarke/iron-altar',
    issueIntake: { enabled: true },
  },
];

type Mocks = {
  dependencies: RetentionDependencies;
  store: jest.Mocked<RetentionStore>;
  attachments: jest.Mocked<AttachmentStore>;
  secrets: jest.Mocked<SecretStore>;
  client: jest.Mocked<IssueClient>;
  githubClientFactory: jest.MockedFunction<GithubClientFactory>;
  logger: jest.Mock;
  metrics: { increment: jest.Mock };
};

export const createMocks = (
  reports: RetentionReportRecord[] = [createdReport],
  overrides: Partial<RetentionDependencies> = {},
): Mocks => {
  const store: jest.Mocked<RetentionStore> = {
    scanCreatedReports: jest.fn().mockResolvedValue(reports),
    markClosed: jest.fn().mockResolvedValue(true),
  };
  const attachments: jest.Mocked<AttachmentStore> = {
    tagForClosure: jest.fn().mockResolvedValue(undefined),
  };
  const secrets: jest.Mocked<SecretStore> = {
    getGithubAppSecret: jest.fn().mockResolvedValue(githubSecret),
  };
  const client: jest.Mocked<IssueClient> = {
    createIssue: jest.fn().mockResolvedValue({ number: 42, htmlUrl: 'https://example.com/42' }),
    getIssue: jest.fn().mockResolvedValue({ state: 'closed' }),
  };
  const githubClientFactory: jest.MockedFunction<GithubClientFactory> = jest.fn((secret) => {
    void secret;
    return client;
  });
  const logger = jest.fn();
  const metrics = { increment: jest.fn() };

  return {
    dependencies: {
      store,
      attachments,
      secrets,
      githubClientFactory,
      applications: appConfigs,
      logger,
      metrics,
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      ...overrides,
    },
    store,
    attachments,
    secrets,
    client,
    githubClientFactory,
    logger,
    metrics,
  };
};
