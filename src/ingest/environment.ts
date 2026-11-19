export type IngestEnvironment = {
  tableName: string;
  bucketName: string;
  queueUrl: string;
};

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const loadIngestEnvironment = (): IngestEnvironment => ({
  tableName: required('REPORTS_TABLE_NAME'),
  bucketName: required('ATTACHMENTS_BUCKET_NAME'),
  queueUrl: required('WORKER_QUEUE_URL'),
});
