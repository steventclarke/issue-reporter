import type {
  IssueReportRequest,
  ReporterIdentity,
  ScreenshotContentType,
} from '@stevenclarke/issue-reporter-core';
import type { ApplicationConfig } from '../../config/applications';

export type StoredReport = Omit<IssueReportRequest, 'screenshot'> & {
  screenshot?: { contentType: ScreenshotContentType } | null;
};

export type WorkerSqsRecord = {
  messageId?: string;
  body: string;
};

export type WorkerEvent = {
  Records?: WorkerSqsRecord[];
};

export type BatchItemFailure = {
  itemIdentifier: string;
};

export type WorkerResponse = {
  batchItemFailures: BatchItemFailure[];
};

export type ReportRecord = {
  pk: string;
  sk: string;
  app: string;
  environment: string;
  status: 'receiving' | 'queued' | 'created' | 'failed';
  installationId: string;
  category: string;
  reportKey: string;
  screenshotKey?: string;
  createdAt: string;
  updatedAt: string;
  subject?: string;
};

export type GithubAppSecret = {
  appId: number | string;
  installationId: number | string;
  privateKey: string;
};

export type CreateIssueInput = {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
};

export type CreatedIssue = {
  number: number;
  htmlUrl: string;
};

export type IssueClient = {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
};

export type GithubClientFactory = (secret: GithubAppSecret) => IssueClient;

export type WorkerFailureCode =
  | 'report_not_found'
  | 'report_invalid'
  | 'app_unknown'
  | 'attachment_unavailable'
  | 'secret_unavailable'
  | 'github_failed'
  | 'internal_error';

export type ReportStore = {
  getReport(reportId: string): Promise<ReportRecord | null>;
  markCreated(
    reportId: string,
    result: Pick<ReportRecord, 'updatedAt'> & CreatedIssue,
  ): Promise<void>;
  markFailed(reportId: string, code: WorkerFailureCode, updatedAt: string): Promise<void>;
};

export type AttachmentStore = {
  getReportJson(key: string): Promise<string>;
};

export type SecretStore = {
  getGithubAppSecret(): Promise<GithubAppSecret>;
};

export type WorkerStructuredLog = {
  reportId?: string;
  app?: string;
  status?: ReportRecord['status'] | 'ignored';
  errorCode?: WorkerFailureCode;
};

export type Logger = (event: WorkerStructuredLog) => void;

export type Metrics = {
  increment(name: string): Promise<void> | void;
};

export type WorkerDependencies = {
  store: ReportStore;
  attachments: AttachmentStore;
  secrets: SecretStore;
  githubClientFactory?: GithubClientFactory;
  applications?: readonly ApplicationConfig[];
  attachmentsBaseUrl?: string;
  logger?: Logger;
  metrics?: Metrics;
  now?: () => Date;
};

export type RenderContext = {
  reportId: string;
  attachmentsBaseUrl: string;
  reporter: ReporterIdentity | null;
};
