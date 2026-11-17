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

export const APP_SLUGS = ['iron-altar'] as const;
export const ENVIRONMENTS = ['prod', 'preview', 'dev'] as const;
export const CATEGORIES = ['bug', 'feature', 'other'] as const;
export const PLATFORMS = ['ios', 'android', 'web'] as const;
export const LOG_LEVELS = ['log', 'info', 'warn', 'error'] as const;
export const SCREENSHOT_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export const REPORTER_PROVIDERS = ['google'] as const;
export const REPORT_STATUSES = ['receiving', 'queued', 'created', 'failed'] as const;
export const ERROR_CODES = [
  'validation_failed',
  'forbidden_origin',
  'method_not_allowed',
  'payload_too_large',
  'rate_limited',
  'internal_error',
] as const;

export const appSlugSchema = z.enum(APP_SLUGS);
export const environmentSchema = z.enum(ENVIRONMENTS);
export const categorySchema = z.enum(CATEGORIES);
export const platformSchema = z.enum(PLATFORMS);
export const logLevelSchema = z.enum(LOG_LEVELS);
export const screenshotContentTypeSchema = z.enum(SCREENSHOT_CONTENT_TYPES);

export const reporterSchema = z
  .object({
    provider: z.enum(REPORTER_PROVIDERS),
    subject: z.string().min(1).max(256),
    email: z.email().max(320).nullish(),
    name: z.string().max(200).nullish(),
  })
  .strip()
  .nullish();

export const setEntrySchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    exerciseId: z.string().min(1),
    weightKg: z.number().nonnegative(),
    reps: z.number().int().nonnegative(),
    isWarmup: z.boolean(),
    notes: z.string().optional(),
    order: z.number().int().nonnegative(),
  })
  .strip();

export const appDataSchema = z
  .object({
    version: z.number().int().nonnegative(),
    profile: z
      .object({
        id: z.string().min(1),
        name: z.string(),
        characterId: z.string(),
        unitPref: z.enum(['kg', 'lb', 'st']),
        createdAt: z.iso.datetime(),
        xp: z.number().nonnegative(),
        lastActivityDate: z.iso.date(),
      })
      .strip()
      .nullable(),
    settings: z
      .object({
        restSeconds: z.number().int().nonnegative(),
      })
      .strip(),
    exercises: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string(),
          category: z.enum(['barbell', 'dumbbell', 'bodyweight', 'machine', 'other']),
          isMainLift: z.boolean(),
          mainLift: z
            .enum(['squat', 'bench', 'deadlift', 'overhead_press', 'power_clean'])
            .optional(),
          muscleGroup: z.string(),
        })
        .strip(),
    ),
    sessions: z.array(
      z
        .object({
          id: z.string().min(1),
          date: z.iso.date(),
          startedAt: z.iso.datetime().optional(),
          endedAt: z.iso.datetime().optional(),
          notes: z.string().optional(),
          completed: z.boolean(),
          totalVolumeKg: z.number().nonnegative(),
          xpEarned: z.number().nonnegative(),
        })
        .strip(),
    ),
    sets: z.array(setEntrySchema),
    bodyWeights: z.array(
      z
        .object({
          id: z.string().min(1),
          date: z.iso.datetime(),
          weightKg: z.number().nonnegative(),
        })
        .strip(),
    ),
    draft: z
      .object({
        id: z.string().min(1),
        date: z.iso.date(),
        startedAt: z.iso.datetime(),
        notes: z.string(),
        sets: z.array(setEntrySchema),
      })
      .strip()
      .nullable(),
  })
  .strip();

export const diagnosticsSchema = z
  .object({
    appVersion: z.string().min(1),
    buildNumber: z.string().nullable(),
    platform: platformSchema,
    osVersion: z.string().nullable(),
    device: z.string().nullable(),
    screen: z
      .object({
        width: z.number().positive(),
        height: z.number().positive(),
        scale: z.number().positive(),
      })
      .strip(),
    route: z.string().min(1),
    database: z
      .object({
        version: z.number().int().nonnegative(),
        profileExists: z.boolean(),
        sessions: z.number().int().nonnegative(),
        sets: z.number().int().nonnegative(),
        bodyWeights: z.number().int().nonnegative(),
        exercises: z.number().int().nonnegative(),
        draftActive: z.boolean(),
      })
      .strip(),
    settings: z
      .object({
        restSeconds: z.number().int().nonnegative(),
        unitPref: z.enum(['kg', 'lb', 'st']),
      })
      .strip(),
    executionEnvironment: z.string().nullable(),
    sessionId: z.string().nullable(),
  })
  .strip();

export const logEntrySchema = z
  .object({
    timestamp: z.iso.datetime(),
    level: logLevelSchema,
    message: z.string(),
    context: z.record(z.string(), z.unknown()).optional(),
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
export const errorResponseSchema = z
  .object({
    error: z.enum(ERROR_CODES),
    issues: z.array(z.unknown()).optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
  })
  .strip();

export type AppSlug = z.infer<typeof appSlugSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Platform = z.infer<typeof platformSchema>;
export type ReporterIdentity = NonNullable<z.infer<typeof reporterSchema>>;
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
