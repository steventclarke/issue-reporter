import {
  API_VERSION,
  LOG_MAX_BYTES,
  REQUEST_BODY_LIMIT_BYTES,
  SANITIZED_DATA_LIMIT_BYTES,
  SCREENSHOT_MAX_BYTES,
  acceptedReportResponseSchema,
  issueReportRequestSchema,
  redactReport,
  type AcceptedReportResponse,
  type IssueReportRequest,
} from '@issue-reporter/core';
import { estimateBase64Bytes } from './base64';
import {
  validateConfig,
  type FetchResponse,
  type IssueReporterConfig,
  type IssueReporterDiagnostic,
  type ResolvedConfig,
} from './config';
import { errorFromResponse, IssueReporterError } from './errors';
import { getInstallationId } from './install-id';
import { createReportId } from './report-id';

type ReportPayload = Omit<
  IssueReportRequest,
  'app' | 'environment' | 'installationId' | 'reportId'
>;

export type ReportSubmission = ReportPayload & { reportId?: string };

export type IssueReporterSuccess = {
  ok: true;
  reportId: string;
  status: AcceptedReportResponse['status'];
};

export type IssueReporterFailure = {
  ok: false;
  reportId: string;
  error: IssueReporterError;
};

export type IssueReporterResult = IssueReporterSuccess | IssueReporterFailure;

export type IssueReporter = {
  submit(input: ReportSubmission): Promise<IssueReporterResult>;
  getInstallationId(): Promise<string>;
};

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

const issuePath = (issue: unknown): string => {
  const path = (issue as { path?: unknown })?.path;
  if (!Array.isArray(path) || path.length === 0) return 'root';
  return path.map(String).join('.');
};

const emitDiagnostic = (config: ResolvedConfig, event: IssueReporterDiagnostic): void => {
  if (!config.onDiagnostic) return;
  try {
    config.onDiagnostic(event);
  } catch {
    return;
  }
};

const enforceLimits = (request: IssueReportRequest, body: string): void => {
  const dataBytes = utf8ByteLength(
    JSON.stringify({
      appData: request.appData,
      diagnostics: request.diagnostics,
      logs: request.logs,
      stackTraces: request.stackTraces,
    }),
  );
  if (dataBytes > SANITIZED_DATA_LIMIT_BYTES) {
    throw new IssueReporterError('payload_too_large', 'Report data exceeds the size limit', {
      part: 'data',
    });
  }

  const logsBytes = utf8ByteLength(JSON.stringify(request.logs ?? []));
  if (logsBytes > LOG_MAX_BYTES) {
    throw new IssueReporterError('payload_too_large', 'Report logs exceed the size limit', {
      part: 'logs',
    });
  }

  if (request.screenshot) {
    const screenshotBytes = estimateBase64Bytes(request.screenshot.dataBase64);
    if (screenshotBytes > SCREENSHOT_MAX_BYTES) {
      throw new IssueReporterError('payload_too_large', 'Screenshot exceeds the size limit', {
        part: 'screenshot',
      });
    }
  }

  if (utf8ByteLength(body) > REQUEST_BODY_LIMIT_BYTES) {
    throw new IssueReporterError('payload_too_large', 'Report request exceeds the size limit', {
      part: 'request',
    });
  }
};

export const createIssueReporter = (config: IssueReporterConfig): IssueReporter => {
  const resolved = validateConfig(config);

  const loadInstallationId = async (): Promise<string> => {
    try {
      return await getInstallationId(resolved.storage, resolved.installationKey);
    } catch {
      throw new IssueReporterError('validation', 'Unable to load the installation ID');
    }
  };

  return {
    getInstallationId: loadInstallationId,

    submit: async (input: ReportSubmission): Promise<IssueReporterResult> => {
      const reportId = input.reportId ?? createReportId();

      try {
        const sanitized = redactReport(input, {
          extraRedactionPatterns: resolved.extraRedactionPatterns,
        });
        const installationId = await loadInstallationId();
        const candidate: IssueReportRequest = {
          ...sanitized,
          app: resolved.app,
          environment: resolved.environment,
          installationId,
          reportId,
          website: sanitized.website ?? '',
        };
        const parsed = issueReportRequestSchema.safeParse(candidate);
        if (!parsed.success) {
          throw new IssueReporterError('validation', 'Report failed local validation', {
            issues: parsed.error.issues.map(issuePath),
          });
        }

        const request = parsed.data;
        const body = JSON.stringify(request);
        enforceLimits(request, body);

        emitDiagnostic(resolved, { event: 'request_started', reportId });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), resolved.timeoutMs);
        let response: FetchResponse;
        try {
          response = await resolved.fetch(`${resolved.endpoint}/${API_VERSION}/reports`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
          });
        } catch {
          throw new IssueReporterError(
            'network',
            controller.signal.aborted ? 'Request timed out' : 'Network request failed',
          );
        } finally {
          clearTimeout(timer);
        }

        emitDiagnostic(resolved, { event: 'response_received', reportId, status: response.status });

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          throw new IssueReporterError('server', 'Invalid response body', {
            status: response.status,
          });
        }

        if (response.status === 202) {
          const accepted = acceptedReportResponseSchema.safeParse(responseBody);
          if (!accepted.success) {
            throw new IssueReporterError('server', 'Invalid accepted response', { status: 202 });
          }
          return {
            ok: true,
            reportId: accepted.data.reportId,
            status: accepted.data.status,
          };
        }

        const error = errorFromResponse(response.status, responseBody);
        if (error.code === 'rate_limited') {
          emitDiagnostic(resolved, {
            event: 'rate_limited',
            reportId,
            status: response.status,
            retryAfterSeconds: error.retryAfterSeconds,
          });
        }
        throw error;
      } catch (error) {
        const issueError =
          error instanceof IssueReporterError
            ? error
            : new IssueReporterError('server', 'Unexpected client error');
        return { ok: false, reportId, error: issueError };
      }
    },
  };
};
