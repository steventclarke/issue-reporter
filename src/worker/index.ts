import { createAwsDependencies } from './aws';
import { loadWorkerEnvironment } from './environment';
import { createGithubClientFactory } from './github';
import { createWorkerHandler } from './handler';

const environment = loadWorkerEnvironment();

export const handler = createWorkerHandler({
  ...createAwsDependencies({
    tableName: environment.tableName,
    bucketName: environment.bucketName,
    secretId: environment.secretId,
  }),
  githubClientFactory: createGithubClientFactory(),
  attachmentsBaseUrl: environment.attachmentsBaseUrl,
});
