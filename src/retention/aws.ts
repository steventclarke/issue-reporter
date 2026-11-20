import { CopyObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { categorySchema } from '@stevenclarke/issue-reporter-core';
import { z } from 'zod';
import type {
  AttachmentStore,
  ClosureUpdate,
  RetentionReportRecord,
  RetentionStore,
  SecretStore,
} from './types';
import type { GithubAppSecret } from '../worker/types';

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
    category: categorySchema,
    reportKey: z.string(),
    screenshotKey: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    subject: z.string().optional(),
    issueNumber: z.number().int().positive().optional(),
    issueUrl: z.string().optional(),
    closureDate: z.string().optional(),
    attachmentExpiryDate: z.string().optional(),
    ttl: z.number().int().optional(),
  })
  .strip();

const copySource = (bucket: string, key: string): string =>
  `${bucket}/${key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;

export const createAwsDependencies = (input: {
  tableName: string;
  bucketName: string;
  secretId: string;
}): {
  store: RetentionStore;
  attachments: AttachmentStore;
  secrets: SecretStore;
} => {
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  const secretsManager = new SecretsManagerClient({});

  return {
    store: {
      scanCreatedReports: async (): Promise<RetentionReportRecord[]> => {
        const records: RetentionReportRecord[] = [];
        let exclusiveStartKey: ScanCommandInput['ExclusiveStartKey'];
        do {
          const response = await documentClient.send(
            new ScanCommand({
              TableName: input.tableName,
              FilterExpression: '#status = :created AND attribute_not_exists(closureDate)',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':created': 'created' },
              ExclusiveStartKey: exclusiveStartKey,
            }),
          );
          records.push(
            ...(response.Items ?? []).map(
              (item) => reportRecordSchema.parse(item) as RetentionReportRecord,
            ),
          );
          exclusiveStartKey = response.LastEvaluatedKey;
        } while (exclusiveStartKey);
        return records;
      },
      markClosed: async (reportId: string, update: ClosureUpdate): Promise<boolean> => {
        try {
          await documentClient.send(
            new UpdateCommand({
              TableName: input.tableName,
              Key: { pk: `REPORT#${reportId}`, sk: 'META' },
              UpdateExpression:
                'SET closureDate = :closureDate, attachmentExpiryDate = :attachmentExpiryDate, ttl = :ttl, #updatedAt = :updatedAt',
              ConditionExpression: 'attribute_not_exists(closureDate)',
              ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
              ExpressionAttributeValues: {
                ':closureDate': update.closureDate,
                ':attachmentExpiryDate': update.attachmentExpiryDate,
                ':ttl': update.ttl,
                ':updatedAt': update.updatedAt,
              },
            }),
          );
          return true;
        } catch (error) {
          if (error instanceof ConditionalCheckFailedException) return false;
          throw error;
        }
      },
    },
    attachments: {
      tagForClosure: async (
        key: string,
        closureDate: string,
        attachmentExpiryDate: string,
      ): Promise<void> => {
        await s3.send(
          new CopyObjectCommand({
            Bucket: input.bucketName,
            Key: key,
            CopySource: copySource(input.bucketName, key),
            MetadataDirective: 'COPY',
            TaggingDirective: 'REPLACE',
            Tagging: `closure-marker=true&closure-date=${encodeURIComponent(
              closureDate,
            )}&attachment-expiry-date=${encodeURIComponent(attachmentExpiryDate)}`,
          }),
        );
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
