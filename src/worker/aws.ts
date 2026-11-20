import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { GithubAppSecret, ReportRecord, WorkerFailureCode, WorkerDependencies } from './types';

const githubSecretSchema = z
  .object({
    appId: z.union([z.number().int().positive(), z.string().min(1)]),
    installationId: z.union([z.number().int().positive(), z.string().min(1)]),
    privateKey: z.string().min(1),
  })
  .strip();

const reportRecordSchema = z
  .object({
    pk: z.string(),
    sk: z.string(),
    app: z.string(),
    environment: z.string(),
    status: z.enum(['receiving', 'queued', 'created', 'failed']),
    installationId: z.string(),
    category: z.string(),
    reportKey: z.string(),
    screenshotKey: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    subject: z.string().optional(),
  })
  .strip();

type AwsDependencies = Pick<WorkerDependencies, 'store' | 'attachments' | 'secrets'>;

export const createAwsDependencies = (input: {
  tableName: string;
  bucketName: string;
  secretId: string;
}): AwsDependencies => {
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  const secretsManager = new SecretsManagerClient({});

  return {
    store: {
      getReport: async (reportId) => {
        const response = await documentClient.send(
          new GetCommand({
            TableName: input.tableName,
            Key: { pk: `REPORT#${reportId}`, sk: 'META' },
          }),
        );
        if (!response.Item) return null;
        return reportRecordSchema.parse(response.Item) as ReportRecord;
      },
      markCreated: async (reportId, result) => {
        await documentClient.send(
          new UpdateCommand({
            TableName: input.tableName,
            Key: { pk: `REPORT#${reportId}`, sk: 'META' },
            UpdateExpression:
              'SET #status = :created, issueNumber = :issueNumber, issueUrl = :issueUrl, #updatedAt = :updatedAt REMOVE #error',
            ConditionExpression: '#status <> :created',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#updatedAt': 'updatedAt',
              '#error': 'error',
            },
            ExpressionAttributeValues: {
              ':created': 'created',
              ':issueNumber': result.number,
              ':issueUrl': result.htmlUrl,
              ':updatedAt': result.updatedAt,
            },
          }),
        );
      },
      markFailed: async (reportId: string, code: WorkerFailureCode, updatedAt: string) => {
        await documentClient.send(
          new UpdateCommand({
            TableName: input.tableName,
            Key: { pk: `REPORT#${reportId}`, sk: 'META' },
            UpdateExpression: 'SET #status = :failed, #error = :error, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#error': 'error',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':failed': 'failed',
              ':error': code,
              ':updatedAt': updatedAt,
            },
          }),
        );
      },
    },
    attachments: {
      getReportJson: async (key) => {
        const response = await s3.send(
          new GetObjectCommand({ Bucket: input.bucketName, Key: key }),
        );
        if (!response.Body) throw new Error('Attachment body missing');
        return response.Body.transformToString();
      },
    },
    secrets: {
      getGithubAppSecret: async (): Promise<GithubAppSecret> => {
        const response = await secretsManager.send(
          new GetSecretValueCommand({ SecretId: input.secretId }),
        );
        if (!response.SecretString) throw new Error('GitHub App secret missing');
        return githubSecretSchema.parse(JSON.parse(response.SecretString) as unknown);
      },
    },
  };
};
