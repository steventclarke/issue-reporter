export const DEFAULT_RETENTION_DAYS = 30;

export type RetentionEnvironment = {
  tableName: string;
  bucketName: string;
  secretId: string;
  retentionDays: number;
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const retentionDays = (): number => {
  const value = process.env.ATTACHMENT_RETENTION_DAYS;
  if (!value) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('ATTACHMENT_RETENTION_DAYS must be a positive integer');
  }
  return parsed;
};

export const loadRetentionEnvironment = (): RetentionEnvironment => ({
  tableName: required('REPORTS_TABLE_NAME'),
  bucketName: required('ATTACHMENTS_BUCKET_NAME'),
  secretId: required('GITHUB_APP_SECRET_ID'),
  retentionDays: retentionDays(),
});
