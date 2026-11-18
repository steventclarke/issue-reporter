import {
  appSlugSchema,
  environmentSchema,
  type AuthFailureReason,
} from '@steventclarke/issue-reporter-core';
import { IssueReporterError } from './errors';
import { installationStorageKey, type StorageAdapter } from './install-id';

export type FetchResponse = {
  readonly status: number;
  json(): Promise<unknown>;
};

export type FetchInit = {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
};

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export type BearerTokenProvider = () => Promise<string | null>;

export type IssueReporterAuthConfig = {
  getBearerToken: BearerTokenProvider;
};

export type IssueReporterDiagnosticEvent =
  | 'request_started'
  | 'response_received'
  | 'rate_limited'
  | 'auth_required'
  | 'auth_failed'
  | 'api_version_mismatch';

export type IssueReporterDiagnostic = {
  event: IssueReporterDiagnosticEvent;
  reportId?: string;
  status?: number;
  retryAfterSeconds?: number;
  reason?: AuthFailureReason;
  apiMajor?: number;
  expectedApiMajor?: number;
};

export type IssueReporterConfig = {
  endpoint: string;
  app: string;
  environment: string;
  storage: StorageAdapter;
  storageKeyPrefix?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  skipApiVersionCheck?: boolean;
  auth?: IssueReporterAuthConfig;
  extraRedactionPatterns?: RegExp[];
  onDiagnostic?: (event: IssueReporterDiagnostic) => void;
};

export type ResolvedConfig = Omit<
  IssueReporterConfig,
  'fetch' | 'timeoutMs' | 'extraRedactionPatterns'
> & {
  endpoint: string;
  fetch: FetchLike;
  timeoutMs: number;
  extraRedactionPatterns: RegExp[];
  installationKey: string;
};

const fail = (message: string): never => {
  throw new IssueReporterError('validation', message);
};

export const validateConfig = (config: IssueReporterConfig): ResolvedConfig => {
  if (!config || typeof config !== 'object') fail('config must be an object');

  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    return fail('endpoint must be a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('endpoint must use http or https');
  }
  if (url.search || url.hash) return fail('endpoint must not include a query or fragment');

  if (!appSlugSchema.safeParse(config.app).success) return fail('app must be a valid slug');
  if (!environmentSchema.safeParse(config.environment).success) {
    return fail('environment must be a valid slug');
  }

  if (
    !config.storage ||
    typeof config.storage.get !== 'function' ||
    typeof config.storage.set !== 'function'
  ) {
    return fail('storage must provide get and set functions');
  }
  if (config.storageKeyPrefix !== undefined && typeof config.storageKeyPrefix !== 'string') {
    return fail('storageKeyPrefix must be a string');
  }

  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fail('fetch is unavailable');

  const timeoutMs = config.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return fail('timeoutMs must be a positive integer');
  }

  if (config.skipApiVersionCheck !== undefined && typeof config.skipApiVersionCheck !== 'boolean') {
    return fail('skipApiVersionCheck must be a boolean');
  }

  if (config.auth !== undefined) {
    if (
      !config.auth ||
      typeof config.auth !== 'object' ||
      typeof config.auth.getBearerToken !== 'function'
    ) {
      return fail('auth.getBearerToken must be a function');
    }
  }

  const extraRedactionPatterns = config.extraRedactionPatterns ?? [];
  if (
    !Array.isArray(extraRedactionPatterns) ||
    extraRedactionPatterns.some((pattern) => !(pattern instanceof RegExp))
  ) {
    return fail('extraRedactionPatterns must contain RegExp values');
  }

  if (config.onDiagnostic !== undefined && typeof config.onDiagnostic !== 'function') {
    return fail('onDiagnostic must be a function');
  }

  return {
    ...config,
    endpoint: url.toString().replace(/\/+$/, ''),
    fetch: fetchImpl,
    timeoutMs,
    extraRedactionPatterns,
    installationKey: installationStorageKey(config.storageKeyPrefix),
  };
};
