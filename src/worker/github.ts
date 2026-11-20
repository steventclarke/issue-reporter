import type {
  CreatedIssue,
  CreateIssueInput,
  GithubAppSecret,
  GithubClientFactory,
  IssueClient,
} from './types';

type OctokitIssueResponse = {
  data: {
    number: number;
    html_url: string;
  };
};

type OctokitLike = {
  rest: {
    issues: {
      create(input: CreateIssueInput): Promise<OctokitIssueResponse>;
    };
  };
};

type AppLike = {
  getInstallationOctokit(installationId: number): OctokitLike | Promise<OctokitLike>;
};

type AppFactory = (options: { appId: number; privateKey: string }) => AppLike | Promise<AppLike>;

const clientCache = new Map<string, Promise<IssueClient>>();

const defaultAppFactory: AppFactory = (options) =>
  import('octokit').then(({ App }) => new App(options) as unknown as AppLike);

export const normalizePrivateKey = (value: string): string =>
  value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

export const clearGithubClientCache = (): void => {
  clientCache.clear();
};

export const createGithubClientFactory = (
  createApp: AppFactory = defaultAppFactory,
): GithubClientFactory => {
  return (secret: GithubAppSecret): IssueClient => {
    const appId = Number(secret.appId);
    const installationId = Number(secret.installationId);
    const privateKey = normalizePrivateKey(secret.privateKey);

    if (!Number.isInteger(appId) || appId <= 0) throw new Error('Invalid GitHub App appId');
    if (!Number.isInteger(installationId) || installationId <= 0) {
      throw new Error('Invalid GitHub App installationId');
    }
    if (!privateKey.includes('PRIVATE KEY')) throw new Error('Invalid GitHub App privateKey');

    const cacheKey = `${appId}:${installationId}`;
    const cached = clientCache.get(cacheKey);
    if (cached) {
      return { createIssue: (input) => cached.then((client) => client.createIssue(input)) };
    }

    const client = Promise.resolve(createApp({ appId, privateKey }))
      .then((app) => app.getInstallationOctokit(installationId))
      .then((octokit) => ({
        createIssue: async (input: CreateIssueInput): Promise<CreatedIssue> => {
          const response = await octokit.rest.issues.create(input);
          return { number: response.data.number, htmlUrl: response.data.html_url };
        },
      }))
      .catch((error: unknown) => {
        clientCache.delete(cacheKey);
        throw error;
      });

    clientCache.set(cacheKey, client);
    return { createIssue: (input) => client.then((resolved) => resolved.createIssue(input)) };
  };
};
