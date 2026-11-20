import { createAwsDependencies } from './aws';
import { loadRetentionEnvironment } from './environment';
import { createGithubClientFactory } from '../worker/github';
import { createRetentionHandler } from './handler';

const environment = loadRetentionEnvironment();

export const handler = createRetentionHandler({
  ...createAwsDependencies({
    tableName: environment.tableName,
    bucketName: environment.bucketName,
    secretId: environment.secretId,
  }),
  githubClientFactory: createGithubClientFactory(),
  retentionDays: environment.retentionDays,
});
