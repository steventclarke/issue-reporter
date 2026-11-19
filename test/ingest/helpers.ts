import type { IssueReportRequest } from '@stevenclarke/issue-reporter-core';
import { allowedOrigins } from '../../config/applications';
import type {
  DynamoStore,
  IngestDependencies,
  IngestEvent,
  Metrics,
  ObjectStore,
  Queue,
  TokenVerifier,
} from '../../src/ingest/types';
import { cloneValidReportRequest } from '../fixtures/issue-report';

export const testOrigin = allowedOrigins[0] as string;

export const testApplications = [
  {
    name: 'example-app',
    repo: 'steventclarke/example-app',
    issueIntake: {
      enabled: true,
      environments: ['production'],
      categories: ['bug'],
      reporterProviders: ['example-sso'],
      labels: ['app:example-app'],
      auth: { mode: 'none' as const },
    },
  },
];

export const makeEvent = (
  body: unknown = cloneValidReportRequest(),
  overrides: Partial<IngestEvent> = {},
): IngestEvent => ({
  rawPath: '/v1/reports',
  body: JSON.stringify(body),
  headers: { origin: testOrigin, 'content-type': 'application/json' },
  requestContext: { http: { method: 'POST' } },
  ...overrides,
});

export const responseJson = (response: { body: string }): Record<string, unknown> =>
  JSON.parse(response.body) as Record<string, unknown>;

export const makeDependencies = (overrides: Partial<IngestDependencies> = {}) => {
  const store = {
    getReport: jest.fn().mockResolvedValue(null),
    putReceiving: jest.fn().mockResolvedValue({ ok: true }),
    updateQueued: jest.fn().mockResolvedValue(undefined),
    deleteReport: jest.fn().mockResolvedValue(undefined),
    consumeRateLimit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 3600 }),
  } as unknown as jest.Mocked<DynamoStore>;
  const objects = {
    putObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ObjectStore>;
  const queue = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Queue>;
  const logger = jest.fn();
  const metrics = {
    increment: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Metrics>;
  const verifier: jest.Mocked<TokenVerifier> = {
    verify: jest.fn().mockResolvedValue({
      subject: 'user-123',
      email: 'user@example.com',
      emailVerified: true,
      name: 'User',
      groups: ['issue-reporter-beta'],
    }),
  };
  const verifierFactory = jest.fn().mockReturnValue(verifier);
  const dependencies: IngestDependencies = {
    applications: testApplications,
    allowedOrigins: [testOrigin],
    store,
    objects,
    queue,
    logger,
    metrics,
    verifierFactory,
    now: () => new Date('2026-11-19T12:00:00.000Z'),
    ...overrides,
  };
  return { dependencies, store, objects, queue, logger, metrics, verifier, verifierFactory };
};

export const withBody = (request: IssueReportRequest): IngestEvent => makeEvent(request);
