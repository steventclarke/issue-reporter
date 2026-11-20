import type {
  CreatedIssue,
  CreateIssueInput,
  GetIssueInput,
  GithubAppSecret,
  GithubClientFactory,
  IssueClient,
  IssueState,
} from './types';

type OctokitIssueResponse = {
  data: {
    number: number;
    html_url: string;
  };
};

type OctokitIssueStateResponse = {
  data: {
    state: IssueState['state'];
  };
};

type OctokitLike = {
  rest: {
    issues: {
      create(input: CreateIssueInput): Promise<OctokitIssueResponse>;
      get(input: GetIssueInput): Promise<OctokitIssueStateResponse>;
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

export const normalizePrivateKey = (value: string): string => {
  const withNewlines = value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (withNewlines.includes('\n')) return withNewlines;

  const parts = withNewlines.split(/\s+/);
  const beginIndex = parts.indexOf('-----BEGIN');
  const beginEndIndex = parts.findIndex((part, index) => index > beginIndex && part === 'KEY-----');
  const endIndex = parts.findIndex((part, index) => index > beginEndIndex && part === '-----END');
  const endEndIndex = parts.findIndex((part, index) => index > endIndex && part === 'KEY-----');

  if (
    beginIndex < 0 ||
    beginEndIndex < 0 ||
    endIndex < 0 ||
    endEndIndex < 0 ||
    endEndIndex !== parts.length - 1
  ) {
    return withNewlines;
  }

  const body = parts.slice(beginEndIndex + 1, endIndex);
  if (body.length === 0) return withNewlines;

  return [
    parts.slice(beginIndex, beginEndIndex + 1).join(' '),
    ...body,
    parts.slice(endIndex, endEndIndex + 1).join(' '),
  ].join('\n');
};

export const clearGithubClientCache = (): void => {
  clientCache.clear();
};

const wrapClient = (client: Promise<IssueClient>): IssueClient => ({
  createIssue: (input) => client.then((resolved) => resolved.createIssue(input)),
  getIssue: (input) => client.then((resolved) => resolved.getIssue(input)),
});

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
      return wrapClient(cached);
    }

    const client = Promise.resolve(createApp({ appId, privateKey }))
      .then((app) => app.getInstallationOctokit(installationId))
      .then((octokit) => ({
        createIssue: async (input: CreateIssueInput): Promise<CreatedIssue> => {
          const response = await octokit.rest.issues.create(input);
          return { number: response.data.number, htmlUrl: response.data.html_url };
        },
        getIssue: async (input: GetIssueInput): Promise<IssueState> => {
          const response = await octokit.rest.issues.get(input);
          return { state: response.data.state };
        },
      }))
      .catch((error: unknown) => {
        clientCache.delete(cacheKey);
        throw error;
      });

    clientCache.set(cacheKey, client);
    return wrapClient(client);
  };
};
