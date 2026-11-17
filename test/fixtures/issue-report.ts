import type { IssueReportRequest } from '../../packages/core/src';

export const fixtureReportId = 'b0f6d8c4-4e84-4e42-8c28-6a4f7c5e2f11';
export const fixtureInstallationId = '0b8c5e42-9f11-4c1a-8c2e-1f7a3d6b9e20';

export const validReportRequest: IssueReportRequest = {
  app: 'iron-altar',
  environment: 'prod',
  reportId: fixtureReportId,
  installationId: fixtureInstallationId,
  category: 'bug',
  summary: 'Rest timer does not start after a set',
  description: 'I logged a set and the rest timer stayed at 0:00.',
  expected: 'The rest timer should start automatically.',
  contact: '',
  reporter: {
    provider: 'google',
    subject: 'google-user-123',
    email: 'alex@example.com',
    name: 'Alex',
  },
  appData: {
    version: 5,
    profile: {
      id: 'profile-1',
      name: 'Alex',
      characterId: 'barbarian',
      unitPref: 'kg',
      createdAt: '2026-01-04T18:20:00.000Z',
      xp: 4200,
      lastActivityDate: '2026-11-14',
    },
    settings: { restSeconds: 120 },
    exercises: [
      {
        id: 'exercise-1',
        name: 'Back Squat',
        category: 'barbell',
        isMainLift: true,
        mainLift: 'squat',
        muscleGroup: 'legs',
      },
    ],
    sessions: [
      {
        id: 'session-1',
        date: '2026-11-14',
        startedAt: '2026-11-14T17:05:00.000Z',
        endedAt: '2026-11-14T17:52:00.000Z',
        notes: 'Felt strong',
        completed: true,
        totalVolumeKg: 5000,
        xpEarned: 120,
      },
    ],
    sets: [
      {
        id: 'set-1',
        sessionId: 'session-1',
        exerciseId: 'exercise-1',
        weightKg: 100,
        reps: 5,
        isWarmup: false,
        notes: 'RPE 8',
        order: 1,
      },
    ],
    bodyWeights: [
      {
        id: 'body-weight-1',
        date: '2026-11-14T06:30:00.000Z',
        weightKg: 82.4,
      },
    ],
    draft: null,
  },
  diagnostics: {
    appVersion: '1.0.0',
    buildNumber: null,
    platform: 'ios',
    osVersion: '18.2',
    device: 'iPhone',
    screen: { width: 1170, height: 2532, scale: 3 },
    route: '/session/abc',
    database: {
      version: 5,
      profileExists: true,
      sessions: 1,
      sets: 1,
      bodyWeights: 1,
      exercises: 1,
      draftActive: false,
    },
    settings: { restSeconds: 120, unitPref: 'kg' },
    executionEnvironment: 'storeClient',
    sessionId: 'abc',
  },
  logs: [
    {
      timestamp: '2026-11-14T17:52:03.120Z',
      level: 'error',
      message: 'Rest timer did not start',
      context: { sessionId: 'session-1', restSeconds: 120 },
    },
  ],
  stackTraces: [
    {
      timestamp: '2026-11-14T17:52:03.121Z',
      message: 'TypeError: Cannot read properties of null',
      stack: 'at startRestTimer (src/state/rest-timer-store.ts:42:11)',
      isFatal: false,
    },
  ],
  client: {
    version: '1.0.0',
    build: null,
    platform: 'ios',
    osVersion: '18.2',
    device: 'iPhone',
    route: '/session/abc',
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
  request.appData!.profile!.name = 'AKIAIOSFODNN7EXAMPLE';
  request.logs![0]!.message = 'api_key=sk-abcdefghijklmnopqrstuvwxyz';
  request.stackTraces![0]!.stack = 'at token ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature")';
  return request;
};
