import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { RATE_LIMIT_WINDOW_SECONDS } from '@stevenclarke/issue-reporter-core';
import { allowedOrigins, applications } from '../../config/applications';
import { createTokenVerifier } from './auth';
import { loadIngestEnvironment } from './environment';
import { createEmfMetrics } from './metrics';
import type {
  DynamoStore,
  IngestDependencies,
  Logger,
  ObjectStore,
  Queue,
  RateLimitScope,
  ReportRecord,
  SqsMessage,
} from './types';

const structuredLogger: Logger = (event) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const reportKeys = (id: string) => ({ pk: `REPORT#${id}`, sk: 'META' });

const createDynamoStore = (tableName: string, client: DynamoDBDocumentClient): DynamoStore => ({
  getReport: async (id) => {
    const result = await client.send(new GetCommand({ TableName: tableName, Key: reportKeys(id) }));
    return (result.Item as ReportRecord | undefined) ?? null;
  },
  putReceiving: async (record) => {
    try {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      const result = await client.send(
        new GetCommand({ TableName: tableName, Key: reportKeys(record.pk.slice(7)) }),
      );
      return { ok: false, existing: result.Item as ReportRecord };
    }
  },
  updateQueued: async (id, keys) => {
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      '#reportKey': 'reportKey',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': 'queued',
      ':updatedAt': new Date().toISOString(),
      ':reportKey': keys.reportKey,
    };
    let updateExpression =
      'SET #status = :status, #updatedAt = :updatedAt, #reportKey = :reportKey';
    if (keys.screenshotKey) {
      expressionAttributeNames['#screenshotKey'] = 'screenshotKey';
      expressionAttributeValues[':screenshotKey'] = keys.screenshotKey;
      updateExpression += ', #screenshotKey = :screenshotKey';
    } else {
      expressionAttributeNames['#screenshotKey'] = 'screenshotKey';
      updateExpression += ' REMOVE #screenshotKey';
    }
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: reportKeys(id),
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }),
    );
  },
  deleteReport: async (id) => {
    await client.send(new DeleteCommand({ TableName: tableName, Key: reportKeys(id) }));
  },
  consumeRateLimit: async (scope: RateLimitScope, value: string, limit: number) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSeconds / RATE_LIMIT_WINDOW_SECONDS) * RATE_LIMIT_WINDOW_SECONDS;
    const ttl = window + RATE_LIMIT_WINDOW_SECONDS;
    const retryAfterSeconds = Math.max(1, ttl - nowSeconds);
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: `RATE#${scope}#${value}#${window}`, sk: 'COUNT' },
          UpdateExpression: 'ADD #count :one SET #ttl = :ttl',
          ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
          ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':ttl': ttl, ':limit': limit },
        }),
      );
      return { allowed: true, retryAfterSeconds };
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return { allowed: false, retryAfterSeconds };
      }
      throw error;
    }
  },
});

const createObjectStore = (bucketName: string, client: S3Client): ObjectStore => ({
  putObject: async (key, body, contentType) => {
    await client.send(
      new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }),
    );
  },
  deleteObject: async (key) => {
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  },
});

const createQueue = (queueUrl: string, client: SQSClient): Queue => ({
  sendMessage: async (message: SqsMessage) => {
    await client.send(
      new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }),
    );
  },
});

export const createAwsDependencies = (): IngestDependencies => {
  const env = loadIngestEnvironment();
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return {
    applications,
    allowedOrigins,
    store: createDynamoStore(env.tableName, documentClient),
    objects: createObjectStore(env.bucketName, new S3Client({})),
    queue: createQueue(env.queueUrl, new SQSClient({})),
    verifierFactory: createTokenVerifier,
    logger: structuredLogger,
    metrics: createEmfMetrics(),
  };
};
