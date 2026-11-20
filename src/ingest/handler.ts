import { createHash } from 'node:crypto';
import {
  API_MAJOR,
  API_VERSION,
  RATE_LIMITS,
  REQUEST_BODY_LIMIT_BYTES,
  issueReportRequestSchema,
  type AuthFailureReason,
  type AcceptedReportResponse,
  type ErrorResponse,
  type IssueReportRequest,
  type ReportStatus,
} from '@stevenclarke/issue-reporter-core';
import { allowedOrigins, applications, type IssueIntakeConfig } from '../../config/applications';
import { createTokenVerifier, reporterFromClaims, verifyBearerToken } from './auth';
import { SanitizationError, sanitizeReport } from './sanitize';
import type {
  DynamoStore,
  IngestDependencies,
  IngestEvent,
  IngestResponse,
  RateLimitScope,
  ReportRecord,
} from './types';

const getHeader = (
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined => {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry?.[1];
};

const publicStatus = (status: ReportStatus): AcceptedReportResponse['status'] =>
  status === 'failed' ? 'queued' : status;

const authResponse = (reason: AuthFailureReason): { status: number; body: ErrorResponse } => {
  if (reason === 'not_allowed') {
    return { status: 403, body: { error: 'forbidden', reason } };
  }
  if (reason === 'auth_unavailable' || reason === 'token_provider_failed') {
    return { status: 503, body: { error: 'auth_unavailable', reason: 'auth_unavailable' } };
  }
  return { status: 401, body: { error: 'unauthorized', reason } };
};

const safeIssues = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  issues.map((issue) => ({ path: issue.path.map(String), message: issue.message }));

const ipHash = (value: string): string =>
  createHash('sha256')
    .update(value.split(',')[0]?.trim() ?? '')
    .digest('hex');

const rollback = async (
  store: DynamoStore,
  objects: IngestDependencies['objects'],
  reportId: string,
  reportKey: string,
  screenshotKey?: string,
): Promise<void> => {
  try {
    await store.deleteReport(reportId);
  } catch {
    return;
  }
  await Promise.allSettled([
    objects.deleteObject(reportKey),
    ...(screenshotKey ? [objects.deleteObject(screenshotKey)] : []),
  ]);
};

export const createIngestHandler = (dependencies: IngestDependencies) => {
  const apps = dependencies.applications ?? applications;
  const origins = dependencies.allowedOrigins ?? allowedOrigins;
  const logger = dependencies.logger ?? (() => undefined);
  const now = dependencies.now ?? (() => new Date());

  return async (event: IngestEvent): Promise<IngestResponse> => {
    const origin = getHeader(event.headers, 'origin');
    if (!origin || !origins.includes(origin)) {
      return {
        statusCode: 403,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'forbidden_origin' } satisfies ErrorResponse),
      };
    }

    const corsHeaders = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-amz-content-sha256',
      'access-control-max-age': '86400',
      vary: 'Origin',
    };
    const respond = (
      statusCode: number,
      body: ErrorResponse | AcceptedReportResponse | Record<string, unknown>,
    ) => ({
      statusCode,
      headers: { 'content-type': 'application/json', ...corsHeaders },
      body: JSON.stringify(body),
    });

    const method = (event.requestContext?.http?.method ?? 'GET').toUpperCase();
    const path = event.rawPath ?? '';
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders, body: '' };
    }
    if (method === 'GET' && path === `/${API_VERSION}/version`) {
      return respond(200, { apiMajor: API_MAJOR, apiVersion: API_VERSION });
    }
    if (method !== 'POST' || path !== `/${API_VERSION}/reports`) {
      return respond(405, { error: 'method_not_allowed' });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64')
      : Buffer.from(event.body ?? '', 'utf8');
    if (rawBody.byteLength > REQUEST_BODY_LIMIT_BYTES) {
      return respond(413, { error: 'payload_too_large' });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return respond(400, {
        error: 'validation_failed',
        issues: [{ path: ['body'], message: 'Invalid JSON' }],
      });
    }

    const parsed = issueReportRequestSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return respond(400, {
        error: 'validation_failed',
        issues: safeIssues(parsed.error.issues),
      });
    }
    const report: IssueReportRequest = parsed.data;
    const appConfig = apps.find((app) => app.name === report.app && app.issueIntake?.enabled);
    if (!appConfig?.issueIntake) {
      return respond(400, {
        error: 'validation_failed',
        issues: [{ path: ['app'], message: 'App is not enabled for issue intake' }],
      });
    }
    const intake: IssueIntakeConfig = appConfig.issueIntake;

    let subject: string | undefined;
    const auth = intake.auth ?? { mode: 'none' };
    if (auth.mode === 'oidc') {
      const verifier = (dependencies.verifierFactory ?? createTokenVerifier)(auth);
      const result = await verifyBearerToken(
        getHeader(event.headers, 'authorization'),
        auth,
        verifier,
      );
      if (!result.ok) {
        logger({
          app: report.app,
          reportId: report.reportId,
          status: 'rejected',
          authReason: result.reason,
        });
        const failure = authResponse(result.reason);
        return respond(failure.status, failure.body);
      }
      report.reporter = reporterFromClaims(result.claims, intake);
      subject = result.claims.subject;
    }

    const invalidValues: { path: string; message: string }[] = [];
    if (!intake.environments.includes(report.environment)) {
      invalidValues.push({
        path: 'environment',
        message: 'Environment is not allowed for this app',
      });
    }
    if (!intake.categories.includes(report.category)) {
      invalidValues.push({ path: 'category', message: 'Category is not allowed for this app' });
    }
    if (report.reporter && !intake.reporterProviders.includes(report.reporter.provider)) {
      invalidValues.push({
        path: 'reporter.provider',
        message: 'Reporter provider is not allowed for this app',
      });
    }
    if (invalidValues.length > 0) {
      return respond(400, { error: 'validation_failed', issues: invalidValues });
    }

    if (report.website && report.website.trim() !== '') {
      await dependencies.metrics?.increment('honeypot_triggered');
      logger({ app: report.app, reportId: report.reportId, status: 'ignored' });
      return respond(202, { reportId: report.reportId, status: 'queued' });
    }

    const existing = await dependencies.store.getReport(report.reportId);
    if (existing) {
      return respond(202, { reportId: report.reportId, status: publicStatus(existing.status) });
    }

    const viewerAddress = getHeader(event.headers, 'cloudfront-viewer-address');
    const rateLimits: { scope: RateLimitScope; value: string; limit: number }[] = [
      { scope: 'install', value: report.installationId, limit: RATE_LIMITS.installation },
    ];
    if (viewerAddress) {
      rateLimits.push({
        scope: 'ip',
        value: ipHash(viewerAddress),
        limit: RATE_LIMITS.ip,
      });
    }
    rateLimits.push({ scope: 'app', value: report.app, limit: RATE_LIMITS.app });
    if (subject) {
      rateLimits.push({ scope: 'subject', value: subject, limit: RATE_LIMITS.installation });
    }

    for (const rateLimit of rateLimits) {
      const result = await dependencies.store.consumeRateLimit(
        rateLimit.scope,
        rateLimit.value,
        rateLimit.limit,
      );
      if (!result.allowed) {
        return respond(429, {
          error: 'rate_limited',
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    }

    let sanitized;
    try {
      sanitized = sanitizeReport(report);
    } catch (error) {
      if (error instanceof SanitizationError) {
        return respond(413, { error: 'payload_too_large' });
      }
      logger({ app: report.app, reportId: report.reportId, status: 'failed' });
      return respond(500, { error: 'internal_error' });
    }

    const reportKey = `attachments/reports/${report.app}/${report.reportId}/report.json`;
    const screenshotKey = sanitized.screenshotExtension
      ? `attachments/reports/${report.app}/${report.reportId}/screenshot.${sanitized.screenshotExtension}`
      : undefined;
    const timestamp = now().toISOString();
    const record: ReportRecord = {
      pk: `REPORT#${report.reportId}`,
      sk: 'META',
      app: report.app,
      environment: report.environment,
      status: 'receiving',
      installationId: report.installationId,
      category: report.category,
      reportKey,
      ...(screenshotKey ? { screenshotKey } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(subject ? { subject } : {}),
    };

    const write = await dependencies.store.putReceiving(record);
    if (!write.ok) {
      return respond(202, {
        reportId: report.reportId,
        status: publicStatus(write.existing.status),
      });
    }

    try {
      await dependencies.objects.putObject(
        reportKey,
        new TextEncoder().encode(sanitized.reportJson),
        'application/json',
      );
      if (screenshotKey && sanitized.screenshotBytes) {
        await dependencies.objects.putObject(
          screenshotKey,
          sanitized.screenshotBytes,
          sanitized.report.screenshot?.contentType ?? 'application/octet-stream',
        );
      }
      await dependencies.store.updateQueued(report.reportId, { reportKey, screenshotKey });
      await dependencies.queue.sendMessage({
        reportId: report.reportId,
        app: report.app,
        environment: report.environment,
      });
      logger({ app: report.app, reportId: report.reportId, status: 'queued' });
      return respond(202, { reportId: report.reportId, status: 'queued' });
    } catch {
      await rollback(
        dependencies.store,
        dependencies.objects,
        report.reportId,
        reportKey,
        screenshotKey,
      );
      logger({ app: report.app, reportId: report.reportId, status: 'failed' });
      return respond(500, { error: 'internal_error' });
    }
  };
};
