import type {
  AttachmentStore,
  GithubAppSecret,
  IssueClient,
  ReportRecord,
  ReportStore,
  SecretStore,
  StoredReport,
  WorkerDependencies,
} from '../../src/worker/types';
import type { ApplicationConfig } from '../../config/applications';

export const reportId = '8c8f1f4e-8d6d-4f7f-9d7a-1d1d5e9d1234';
export const installationId = 'b0f5de9b-4f5b-4c6f-9a1c-9a5b8a4e1f10';

export const createdIssue = {
  number: 42,
  htmlUrl: 'https://github.com/steventclarke/iron-altar/issues/42',
};

export const baseReport: StoredReport = {
  app: 'iron-altar',
  environment: 'prod',
  reportId,
  installationId,
  category: 'bug',
  summary: 'Workout screen freezes after saving',
  description: 'Tapping save freezes the workout screen.',
  expected: 'The workout saves and returns to the session list.',
  contact: 'alex@example.com',
  reporter: {
    provider: 'cognito',
    subject: 'cognito-sub-123',
    email: 'alex@example.com',
    name: 'Alex',
  },
  appData: {
    databaseVersion: 5,
    profile: 'Alex',
    sessions: 42,
    sets: 318,
  },
  diagnostics: {
    screen: 'Workout',
    route: '/session/abc',
  },
  logs: [
    {
      timestamp: '2026-01-02T03:00:00.000Z',
      level: 'error',
      message: 'save failed',
      context: { code: 'E_TIMEOUT' },
    },
  ],
  stackTraces: [
    {
      timestamp: '2026-01-02T03:00:01.000Z',
      message: 'TypeError: invalid state',
      stack: 'Error: invalid state\n  at save (app.ts:10:2)',
      isFatal: true,
    },
  ],
  client: {
    version: '1.2.3',
    build: '42',
    platform: 'ios',
    osVersion: '18.2',
    device: 'iPhone',
    route: '/session/abc',
  },
  screenshot: null,
};

export const baseRecord: ReportRecord = {
  pk: `REPORT#${reportId}`,
  sk: 'META',
  app: 'iron-altar',
  environment: 'prod',
  status: 'queued',
  installationId,
  category: 'bug',
  reportKey: `attachments/reports/iron-altar/${reportId}/report.json`,
  createdAt: '2026-01-02T03:00:00.000Z',
  updatedAt: '2026-01-02T03:01:00.000Z',
  subject: 'cognito-sub-123',
};

export const appConfigs: ApplicationConfig[] = [
  {
    name: 'iron-altar',
    repo: 'steventclarke/iron-altar',
    issueIntake: {
      enabled: true,
      environments: ['prod', 'preview', 'dev'],
      categories: ['bug', 'feature', 'other'],
      reporterProviders: ['cognito'],
      labels: ['app:iron-altar'],
      auth: { mode: 'none' as const },
    },
  },
];

export const githubSecret: GithubAppSecret = {
  appId: 123456,
  installationId: 654321,
  privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
};

export const sqsBody = JSON.stringify({
  reportId,
  app: 'iron-altar',
  environment: 'prod',
});

type Mocks = {
  dependencies: WorkerDependencies;
  store: jest.Mocked<ReportStore>;
  attachments: jest.Mocked<AttachmentStore>;
  secrets: jest.Mocked<SecretStore>;
  client: jest.Mocked<IssueClient>;
  githubClientFactory: jest.MockedFunction<(secret: GithubAppSecret) => IssueClient>;
  logger: jest.Mock;
  metrics: { increment: jest.Mock };
};

export const createMocks = (overrides: Partial<WorkerDependencies> = {}): Mocks => {
  const store: jest.Mocked<ReportStore> = {
    getReport: jest.fn().mockResolvedValue(baseRecord),
    markCreated: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const attachments: jest.Mocked<AttachmentStore> = {
    getReportJson: jest.fn().mockResolvedValue(JSON.stringify(baseReport)),
  };
  const secrets: jest.Mocked<SecretStore> = {
    getGithubAppSecret: jest.fn().mockResolvedValue(githubSecret),
  };
  const client: jest.Mocked<IssueClient> = {
    createIssue: jest.fn().mockResolvedValue(createdIssue),
    getIssue: jest.fn().mockResolvedValue({ state: 'open' }),
  };
  const githubClientFactory: jest.MockedFunction<(secret: GithubAppSecret) => IssueClient> =
    jest.fn((secret) => {
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
      attachmentsBaseUrl: 'https://issues.stevenclarke.dev',
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
