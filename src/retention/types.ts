import type { GithubAppSecret, GithubClientFactory, ReportRecord } from '../worker/types';

export type RetentionReportRecord = ReportRecord & {
  issueNumber?: number;
  issueUrl?: string;
  closureDate?: string;
  attachmentExpiryDate?: string;
  ttl?: number;
};

export type ClosureUpdate = {
  closureDate: string;
  attachmentExpiryDate: string;
  ttl: number;
  updatedAt: string;
};

export type RetentionFailureCode =
  | 'secret_unavailable'
  | 'app_unknown'
  | 'issue_missing'
  | 'issue_unavailable'
  | 'tagging_failed'
  | 'internal_error';

export type RetentionStore = {
  scanCreatedReports(): Promise<RetentionReportRecord[]>;
  markClosed(reportId: string, update: ClosureUpdate): Promise<boolean>;
};

export type AttachmentStore = {
  tagForClosure(key: string, closureDate: string, attachmentExpiryDate: string): Promise<void>;
};

export type SecretStore = {
  getGithubAppSecret(): Promise<GithubAppSecret>;
};

export type RetentionStructuredLog = {
  reportId?: string;
  app?: string;
  status?: ReportRecord['status'] | 'failed' | 'ignored';
  errorCode?: RetentionFailureCode;
};

export type Logger = (event: RetentionStructuredLog) => void;

export type Metrics = {
  increment(name: string): Promise<void> | void;
};

export type RetentionDependencies = {
  store: RetentionStore;
  attachments: AttachmentStore;
  secrets: SecretStore;
  githubClientFactory?: GithubClientFactory;
  applications?: readonly {
    name: string;
    repo: string;
    issueIntake?: { enabled: boolean };
  }[];
  retentionDays?: number;
  logger?: Logger;
  metrics?: Metrics;
  now?: () => Date;
};
