import type {
  AuthFailureReason,
  IssueReportRequest,
  ReporterIdentity,
  ReportStatus,
} from '@stevenclarke/issue-reporter-core';
import type { ApplicationConfig, IssueIntakeAuthConfig } from '../../config/applications';

export type IngestEvent = {
  version?: string;
  rawPath?: string;
  isBase64Encoded?: boolean;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

export type IngestResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export type VerifiedClaims = {
  subject: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  groups?: string[];
};

export type TokenVerifier = {
  verify(token: string): Promise<VerifiedClaims>;
};

export type TokenVerifierFactory = (auth: IssueIntakeAuthConfig) => TokenVerifier;

export type VerificationResult =
  { ok: true; claims: VerifiedClaims } | { ok: false; reason: AuthFailureReason };

export type ReportRecord = {
  pk: string;
  sk: string;
  app: string;
  environment: string;
  status: ReportStatus;
  installationId: string;
  category: string;
  reportKey: string;
  screenshotKey?: string;
  createdAt: string;
  updatedAt: string;
  subject?: string;
};

export type RateLimitScope = 'install' | 'ip' | 'app' | 'subject';

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type DynamoStore = {
  getReport(reportId: string): Promise<ReportRecord | null>;
  putReceiving(record: ReportRecord): Promise<{ ok: true } | { ok: false; existing: ReportRecord }>;
  updateQueued(
    reportId: string,
    keys: Pick<ReportRecord, 'reportKey' | 'screenshotKey'>,
  ): Promise<void>;
  deleteReport(reportId: string): Promise<void>;
  consumeRateLimit(scope: RateLimitScope, value: string, limit: number): Promise<RateLimitResult>;
};

export type ObjectStore = {
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
};

export type SqsMessage = {
  reportId: string;
  app: string;
  environment: string;
};

export type Queue = {
  sendMessage(message: SqsMessage): Promise<void>;
};

export type StructuredLog = {
  reportId?: string;
  app?: string;
  status?: ReportStatus | 'rejected' | 'ignored';
  authReason?: AuthFailureReason;
};

export type Logger = (event: StructuredLog) => void;

export type Metrics = {
  increment(name: string): Promise<void> | void;
};

export type SanitizedReport = {
  report: IssueReportRequest;
  reportJson: string;
  screenshotBytes: Uint8Array | null;
  screenshotExtension: 'jpg' | 'png' | null;
};

export type IngestDependencies = {
  applications?: ApplicationConfig[];
  allowedOrigins?: readonly string[];
  store: DynamoStore;
  objects: ObjectStore;
  queue: Queue;
  verifierFactory?: TokenVerifierFactory;
  logger?: Logger;
  metrics?: Metrics;
  now?: () => Date;
};

export type ReporterIdentityInput = ReporterIdentity;
