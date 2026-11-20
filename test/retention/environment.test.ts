import { DEFAULT_RETENTION_DAYS, loadRetentionEnvironment } from '../../src/retention/environment';

const originalEnv = { ...process.env };

describe('loadRetentionEnvironment', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ATTACHMENT_RETENTION_DAYS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads required values and defaults to 30 days', () => {
    process.env.REPORTS_TABLE_NAME = 'reports';
    process.env.ATTACHMENTS_BUCKET_NAME = 'attachments';
    process.env.GITHUB_APP_SECRET_ID = 'github-secret';

    expect(loadRetentionEnvironment()).toEqual({
      tableName: 'reports',
      bucketName: 'attachments',
      secretId: 'github-secret',
      retentionDays: DEFAULT_RETENTION_DAYS,
    });
  });

  it('accepts a positive retention override', () => {
    process.env.REPORTS_TABLE_NAME = 'reports';
    process.env.ATTACHMENTS_BUCKET_NAME = 'attachments';
    process.env.GITHUB_APP_SECRET_ID = 'github-secret';
    process.env.ATTACHMENT_RETENTION_DAYS = '7';

    expect(loadRetentionEnvironment().retentionDays).toBe(7);
  });

  it('rejects a non-positive retention override', () => {
    process.env.REPORTS_TABLE_NAME = 'reports';
    process.env.ATTACHMENTS_BUCKET_NAME = 'attachments';
    process.env.GITHUB_APP_SECRET_ID = 'github-secret';
    process.env.ATTACHMENT_RETENTION_DAYS = '0';

    expect(() => loadRetentionEnvironment()).toThrow(
      'ATTACHMENT_RETENTION_DAYS must be a positive integer',
    );
  });

  it('requires table, bucket, and secret configuration', () => {
    delete process.env.REPORTS_TABLE_NAME;
    delete process.env.ATTACHMENTS_BUCKET_NAME;
    delete process.env.GITHUB_APP_SECRET_ID;

    expect(() => loadRetentionEnvironment()).toThrow(
      'Missing required environment variable: REPORTS_TABLE_NAME',
    );
  });
});
