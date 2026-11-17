import { errorResponseSchema } from '@issue-reporter/core';

export type IssueReporterErrorCode =
  'validation' | 'forbidden_origin' | 'payload_too_large' | 'rate_limited' | 'network' | 'server';

export type IssueReporterErrorPart = 'request' | 'data' | 'logs' | 'screenshot';

export type IssueReporterErrorDetails = {
  status?: number;
  part?: IssueReporterErrorPart;
  issues?: string[];
  retryAfterSeconds?: number;
};

export class IssueReporterError extends Error {
  readonly code: IssueReporterErrorCode;
  readonly status?: number;
  readonly part?: IssueReporterErrorPart;
  readonly issues?: string[];
  readonly retryAfterSeconds?: number;

  constructor(
    code: IssueReporterErrorCode,
    message: string,
    details: IssueReporterErrorDetails = {},
  ) {
    super(message);
    this.name = 'IssueReporterError';
    this.code = code;
    this.status = details.status;
    this.part = details.part;
    this.issues = details.issues;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

const issuePath = (issue: unknown): string => {
  const path = (issue as { path?: unknown })?.path;
  if (!Array.isArray(path) || path.length === 0) return 'root';
  return path.map(String).join('.');
};

const ERROR_MESSAGES: Record<IssueReporterErrorCode, string> = {
  validation: 'The report was rejected as invalid',
  forbidden_origin: 'The report origin is not allowed',
  payload_too_large: 'The report is too large',
  rate_limited: 'Too many reports were submitted recently',
  network: 'The report could not be sent',
  server: 'The report service returned an unexpected response',
};

export const errorFromResponse = (status: number, body: unknown): IssueReporterError => {
  const parsed = errorResponseSchema.safeParse(body);
  const details: IssueReporterErrorDetails = { status };
  const issues =
    parsed.success && parsed.data.issues ? parsed.data.issues.map(issuePath) : undefined;
  if (issues) details.issues = issues;
  if (parsed.success && parsed.data.retryAfterSeconds !== undefined) {
    details.retryAfterSeconds = parsed.data.retryAfterSeconds;
  }

  let code: IssueReporterErrorCode = 'server';
  if (status === 400) code = 'validation';
  if (status === 403) code = 'forbidden_origin';
  if (status === 413) code = 'payload_too_large';
  if (status === 429) code = 'rate_limited';

  return new IssueReporterError(code, ERROR_MESSAGES[code], details);
};
