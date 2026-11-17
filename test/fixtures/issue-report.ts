import type { IssueReportRequest } from '../../packages/core/src';

export const fixtureReportId = 'b0f6d8c4-4e84-4e42-8c28-6a4f7c5e2f11';
export const fixtureInstallationId = '0b8c5e42-9f11-4c1a-8c2e-1f7a3d6b9e20';

export const validReportRequest: IssueReportRequest = {
  app: 'example-app',
  environment: 'production',
  reportId: fixtureReportId,
  installationId: fixtureInstallationId,
  category: 'bug',
  summary: 'Repeated action leaves the screen in an unexpected state',
  description: 'I repeated the action twice and the screen stopped updating.',
  expected: 'The screen should keep updating after each action.',
  contact: '',
  reporter: {
    provider: 'example-sso',
    subject: 'example-user-123',
    email: 'alex@example.com',
    name: 'Alex',
  },
  appData: {
    schemaVersion: 4,
    profile: { displayName: 'Alex', preferences: { unit: 'kg' } },
    records: [{ id: 'record-1', value: 100, tags: ['sample'] }],
    draft: null,
  },
  diagnostics: {
    runtime: 'example-runtime/1.0.0',
    screen: { width: 1170, height: 2532, scale: 3 },
    flags: { beta: true, offlineMode: false },
    activeRoute: '/records/record-1',
  },
  logs: [
    {
      timestamp: '2026-11-14T17:52:03.120Z',
      level: 'error',
      message: 'Action did not complete',
      context: { recordId: 'record-1', retryCount: 2 },
    },
  ],
  stackTraces: [
    {
      timestamp: '2026-11-14T17:52:03.121Z',
      message: 'TypeError: Cannot read properties of null',
      stack: 'at updateView (src/state/example-store.ts:42:11)',
      isFatal: false,
    },
  ],
  client: {
    version: '1.0.0',
    build: null,
    platform: 'mobile',
    osVersion: '18.2',
    device: 'Example device',
    route: '/records/record-1',
  },
  screenshot: {
    contentType: 'image/jpeg',
    dataBase64: 'L2Zha2UganBlZyBieXRlcw==',
  },
  website: '',
};

export const cloneValidReportRequest = (): IssueReportRequest =>
  JSON.parse(JSON.stringify(validReportRequest)) as IssueReportRequest;

export const secretBearingReportRequest = (): IssueReportRequest => {
  const request = cloneValidReportRequest();
  request.summary = 'Token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked';
  request.description = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz';
  const appData = request.appData as unknown as { profile: { displayName: string } };
  appData.profile.displayName = 'AKIAIOSFODNN7EXAMPLE';
  request.logs![0]!.message = 'api_key=sk-abcdefghijklmnopqrstuvwxyz';
  request.stackTraces![0]!.stack = 'at token ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature")';
  return request;
};
