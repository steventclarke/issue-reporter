import {
  LOG_MAX_BYTES,
  SANITIZED_DATA_LIMIT_BYTES,
  SCREENSHOT_MAX_BYTES,
  redactReport,
  type IssueReportRequest,
  type LogEntry,
  type StackTraceEntry,
} from '@stevenclarke/issue-reporter-core';
import type { SanitizedReport } from './types';

export class SanitizationError extends Error {
  constructor(readonly code: 'screenshot' | 'data') {
    super(code);
    this.name = 'SanitizationError';
  }
}

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

export const sanitizeLogs = (
  logs: LogEntry[] | null | undefined,
): LogEntry[] | null | undefined => {
  if (!logs) return logs;
  return logs.flatMap((entry) => {
    try {
      return [redactReport(entry)];
    } catch {
      return [];
    }
  });
};

const sanitizeStackTraces = (
  stackTraces: StackTraceEntry[] | null | undefined,
): StackTraceEntry[] | null | undefined => {
  if (!stackTraces) return stackTraces;
  return stackTraces.map((entry) => redactReport(entry));
};

export const sanitizeReport = (request: IssueReportRequest): SanitizedReport => {
  const sanitized = redactReport({
    ...request,
    logs: sanitizeLogs(request.logs),
    stackTraces: sanitizeStackTraces(request.stackTraces),
  });

  const logsJson = JSON.stringify(sanitized.logs ?? []);
  if (utf8ByteLength(logsJson) > LOG_MAX_BYTES) throw new SanitizationError('data');

  const { dataBase64, ...screenshotMetadata } = sanitized.screenshot ?? {};
  const storedReport = {
    ...sanitized,
    screenshot: sanitized.screenshot ? screenshotMetadata : null,
  };
  const reportJson = JSON.stringify(storedReport);
  if (utf8ByteLength(reportJson) > SANITIZED_DATA_LIMIT_BYTES) {
    throw new SanitizationError('data');
  }

  let screenshotBytes: Uint8Array | null = null;
  let screenshotExtension: 'jpg' | 'png' | null = null;
  if (sanitized.screenshot) {
    screenshotExtension = sanitized.screenshot.contentType === 'image/png' ? 'png' : 'jpg';
    try {
      screenshotBytes = new Uint8Array(Buffer.from(dataBase64 ?? '', 'base64'));
    } catch {
      throw new SanitizationError('screenshot');
    }
    if (screenshotBytes.byteLength > SCREENSHOT_MAX_BYTES) {
      throw new SanitizationError('screenshot');
    }
  }

  return { report: sanitized, reportJson, screenshotBytes, screenshotExtension };
};
