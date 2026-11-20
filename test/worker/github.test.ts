import {
  clearGithubClientCache,
  createGithubClientFactory,
  normalizePrivateKey,
} from '../../src/worker/github';
import type { CreateIssueInput } from '../../src/worker/types';
import { githubSecret } from './helpers';

const issueInput: CreateIssueInput = {
  owner: 'steventclarke',
  repo: 'iron-altar',
  title: '[iron-altar v1.2.3] Bug',
  body: 'Body',
};

describe('GitHub client factory', () => {
  beforeEach(() => {
    clearGithubClientCache();
  });

  it('normalizes escaped private-key newlines', () => {
    expect(normalizePrivateKey('a\\r\\nb\\nc')).toBe('a\nb\nc');
  });

  it('normalizes literal newlines and carriage returns', () => {
    expect(normalizePrivateKey('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('normalizes space-separated PEM keys', () => {
    expect(
      normalizePrivateKey('-----BEGIN RSA PRIVATE KEY----- abc def -----END RSA PRIVATE KEY-----'),
    ).toBe('-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----');
  });

  it('leaves unrelated values trimmed', () => {
    expect(normalizePrivateKey('  value  ')).toBe('value');
  });

  it('creates an app client, normalizes the key, and caches the installation client', async () => {
    const create = jest.fn(async () => ({
      data: { number: 7, html_url: 'https://github.com/steventclarke/iron-altar/issues/7' },
    }));
    const get = jest.fn(async () => ({ data: { state: 'closed' as const } }));
    const installationOctokit = { rest: { issues: { create, get } } };
    const getInstallationOctokit = jest.fn(() => installationOctokit);
    const createApp = jest.fn(() => ({ getInstallationOctokit }));
    const factory = createGithubClientFactory(createApp);
    const secret = {
      ...githubSecret,
      privateKey: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    };

    const client = factory(secret);
    const result = await client.createIssue(issueInput);
    const state = await client.getIssue({
      owner: 'steventclarke',
      repo: 'iron-altar',
      issueNumber: 7,
    });
    await factory(secret).createIssue(issueInput);

    expect(createApp).toHaveBeenCalledTimes(1);
    expect(createApp).toHaveBeenCalledWith({
      appId: 123456,
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
    expect(getInstallationOctokit).toHaveBeenCalledTimes(1);
    expect(getInstallationOctokit).toHaveBeenCalledWith(654321);
    expect(result).toEqual({
      number: 7,
      htmlUrl: 'https://github.com/steventclarke/iron-altar/issues/7',
    });
    expect(state).toEqual({ state: 'closed' });
    expect(get).toHaveBeenCalledWith({
      owner: 'steventclarke',
      repo: 'iron-altar',
      issueNumber: 7,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid app credentials before calling Octokit', () => {
    const createApp = jest.fn(() => ({
      getInstallationOctokit: jest.fn(),
    }));
    const factory = createGithubClientFactory(createApp);

    expect(() => factory({ ...githubSecret, appId: 'abc' })).toThrow('Invalid GitHub App appId');
    expect(createApp).not.toHaveBeenCalled();
  });
});
