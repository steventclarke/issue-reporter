export * from '@issue-reporter/core';

export { estimateBase64Bytes } from './base64';
export {
  validateConfig,
  type BearerTokenProvider,
  type FetchInit,
  type FetchLike,
  type FetchResponse,
  type IssueReporterAuthConfig,
  type IssueReporterConfig,
  type IssueReporterDiagnostic,
  type IssueReporterDiagnosticEvent,
  type ResolvedConfig,
} from './config';
export {
  errorFromResponse,
  IssueReporterError,
  type IssueReporterErrorCode,
  type IssueReporterErrorDetails,
  type IssueReporterErrorPart,
} from './errors';
export {
  getInstallationId,
  installationStorageKey,
  normalizeStorageKeyPrefix,
  type StorageAdapter,
} from './install-id';
export { createReportId } from './report-id';
export {
  createIssueReporter,
  type IssueReporter,
  type IssueReporterFailure,
  type IssueReporterResult,
  type IssueReporterSuccess,
  type ReportSubmission,
} from './submit';
