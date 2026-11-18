import { z } from 'zod';
import {
  CONTACT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  EXPECTED_MAX_LENGTH,
  LOG_MAX_ENTRIES,
  STACK_TRACE_MAX_ENTRIES,
  SUMMARY_MAX_LENGTH,
  SUMMARY_MIN_LENGTH,
} from './limits';

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export const LOG_LEVELS = ['log', 'info', 'warn', 'error'] as const;
export const SCREENSHOT_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export const REPORT_STATUSES = ['receiving', 'queued', 'created', 'failed'] as const;
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'forbidden_origin',
  'method_not_allowed',
  'payload_too_large',
  'rate_limited',
  'auth_unavailable',
  'internal_error',
] as const;
export const AUTH_FAILURE_REASONS = [
  'missing_token',
  'invalid_token',
  'expired_token',
  'not_allowed',
  'token_provider_failed',
  'auth_unavailable',
] as const;

export const appSlugSchema = slugSchema;
export const environmentSchema = slugSchema;
export const categorySchema = slugSchema;
export const platformSchema = slugSchema;
export const reporterProviderSchema = slugSchema;
export const logLevelSchema = z.enum(LOG_LEVELS);
export const screenshotContentTypeSchema = z.enum(SCREENSHOT_CONTENT_TYPES);
export const authFailureReasonSchema = z.enum(AUTH_FAILURE_REASONS);

export const jsonValueSchema = z.json();
export const appDataSchema = jsonValueSchema;
export const diagnosticsSchema = z.record(z.string(), z.json());

export const reporterSchema = z
  .object({
    provider: reporterProviderSchema,
    subject: z.string().min(1).max(256),
    email: z.email().max(320).nullish(),
    name: z.string().max(200).nullish(),
  })
  .strip()
  .nullish();

export const logEntrySchema = z
  .object({
    timestamp: z.iso.datetime(),
    level: logLevelSchema,
    message: z.string(),
    context: z.record(z.string(), z.json()).optional(),
  })
  .strip();

export const stackTraceEntrySchema = z
  .object({
    timestamp: z.iso.datetime(),
    message: z.string(),
    stack: z.string(),
    isFatal: z.boolean(),
  })
  .strip();

export const clientInfoSchema = z
  .object({
    version: z.string().min(1),
    build: z.string().nullable(),
    platform: platformSchema,
    osVersion: z.string().nullable(),
    device: z.string().nullable(),
    route: z.string().min(1),
  })
  .strip();

export const screenshotSchema = z
  .object({
    contentType: screenshotContentTypeSchema,
    dataBase64: z.base64().min(1),
  })
  .strip();

export const issueReportRequestSchema = z
  .object({
    app: appSlugSchema,
    environment: environmentSchema,
    reportId: z.uuid(),
    installationId: z.uuid(),
    category: categorySchema,
    summary: z.string().min(SUMMARY_MIN_LENGTH).max(SUMMARY_MAX_LENGTH),
    description: z.string().min(DESCRIPTION_MIN_LENGTH).max(DESCRIPTION_MAX_LENGTH),
    expected: z.string().max(EXPECTED_MAX_LENGTH).optional(),
    contact: z.string().max(CONTACT_MAX_LENGTH).optional(),
    reporter: reporterSchema,
    appData: appDataSchema.nullable().optional(),
    diagnostics: diagnosticsSchema.nullable().optional(),
    logs: z.array(logEntrySchema).max(LOG_MAX_ENTRIES).nullable().optional(),
    stackTraces: z.array(stackTraceEntrySchema).max(STACK_TRACE_MAX_ENTRIES).nullable().optional(),
    client: clientInfoSchema,
    screenshot: screenshotSchema.nullable().optional(),
    website: z.string().max(200).optional(),
  })
  .strip();

export const reportStatusSchema = z.enum(REPORT_STATUSES);
export const acceptedStatusSchema = z.enum(['receiving', 'queued', 'created']);
export const acceptedReportResponseSchema = z
  .object({
    reportId: z.uuid(),
    status: acceptedStatusSchema,
  })
  .strip();
export const apiVersionResponseSchema = z
  .object({
    apiMajor: z.number().int().positive(),
    apiVersion: z.string().regex(/^v[1-9]\d*$/),
  })
  .strip();

export const errorResponseSchema = z
  .object({
    error: z.enum(ERROR_CODES),
    issues: z.array(z.unknown()).optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
    reason: authFailureReasonSchema.optional(),
  })
  .strip();

export type AppSlug = z.infer<typeof appSlugSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Platform = z.infer<typeof platformSchema>;
export type ReporterIdentity = NonNullable<z.infer<typeof reporterSchema>>;
export type JsonValue = z.infer<typeof jsonValueSchema>;
export type AppDataSnapshot = z.infer<typeof appDataSchema>;
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
export type LogEntry = z.infer<typeof logEntrySchema>;
export type StackTraceEntry = z.infer<typeof stackTraceEntrySchema>;
export type ClientInfo = z.infer<typeof clientInfoSchema>;
export type ScreenshotAttachment = z.infer<typeof screenshotSchema>;
export type IssueReportRequest = z.infer<typeof issueReportRequestSchema>;
export type ReportStatus = z.infer<typeof reportStatusSchema>;
export type AcceptedReportResponse = z.infer<typeof acceptedReportResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type ApiVersionResponse = z.infer<typeof apiVersionResponseSchema>;
export type AuthFailureReason = z.infer<typeof authFailureReasonSchema>;
