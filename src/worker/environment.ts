export type WorkerEnvironment = {
  tableName: string;
  bucketName: string;
  secretId: string;
  attachmentsBaseUrl: string;
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const loadWorkerEnvironment = (): WorkerEnvironment => ({
  tableName: required('REPORTS_TABLE_NAME'),
  bucketName: required('ATTACHMENTS_BUCKET_NAME'),
  secretId: required('GITHUB_APP_SECRET_ID'),
  attachmentsBaseUrl: required('ATTACHMENTS_BASE_URL'),
});
