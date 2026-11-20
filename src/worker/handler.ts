import {
  appSlugSchema,
  environmentSchema,
  issueReportRequestSchema,
  screenshotContentTypeSchema,
} from '@stevenclarke/issue-reporter-core';
import { z } from 'zod';
import { applications as configuredApplications } from '../../config/applications';
import { renderIssueBody, renderIssueLabels, renderIssueTitle } from './render';
import type {
  CreateIssueInput,
  StoredReport,
  WorkerDependencies,
  WorkerEvent,
  WorkerFailureCode,
  WorkerResponse,
  WorkerSqsRecord,
} from './types';

const sqsMessageSchema = z
  .object({
    reportId: z.uuid(),
    app: appSlugSchema,
    environment: environmentSchema,
  })
  .strip();

const storedReportSchema = issueReportRequestSchema.extend({
  screenshot: z.object({ contentType: screenshotContentTypeSchema }).strip().nullable().optional(),
});

class WorkerError extends Error {
  constructor(readonly code: WorkerFailureCode) {
    super(code);
  }
}

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new WorkerError('report_invalid');
  }
};

const isUnprocessable = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  (error as { status?: number }).status === 422;

const repositoryParts = (repository: string): [string, string] => {
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new WorkerError('app_unknown');
  return [parts[0], parts[1]];
};

const processReport = async (
  message: { reportId: string; app: string; environment: string },
  dependencies: WorkerDependencies,
  timestamp: string,
): Promise<'created' | 'ignored'> => {
  const logger = dependencies.logger ?? (() => undefined);
  const applications = dependencies.applications ?? configuredApplications;
  const record = await dependencies.store.getReport(message.reportId);

  if (!record) throw new WorkerError('report_not_found');

  logger({ reportId: message.reportId, app: record.app, status: record.status });

  if (record.status === 'created') {
    dependencies.metrics?.increment('worker.report.ignored');
    return 'ignored';
  }

  if (record.app !== message.app || record.environment !== message.environment) {
    throw new WorkerError('report_invalid');
  }

  const appConfig = applications.find((candidate) => candidate.name === record.app);
  const intake = appConfig?.issueIntake;
  if (
    !appConfig ||
    !intake?.enabled ||
    !intake.environments.includes(record.environment) ||
    !intake.categories.includes(record.category)
  ) {
    throw new WorkerError('app_unknown');
  }

  const reportJson = await dependencies.attachments.getReportJson(record.reportKey);
  const parsedReport = storedReportSchema.safeParse(parseJson(reportJson));
  if (!parsedReport.success) throw new WorkerError('report_invalid');

  const report = parsedReport.data as StoredReport;
  if (
    report.reportId !== message.reportId ||
    report.app !== record.app ||
    report.environment !== record.environment
  ) {
    throw new WorkerError('report_invalid');
  }

  const secret = await dependencies.secrets.getGithubAppSecret();
  const client = (
    dependencies.githubClientFactory ??
    (() => {
      throw new WorkerError('secret_unavailable');
    })
  )(secret);

  const [owner, repo] = repositoryParts(appConfig.repo);
  const renderReport: StoredReport = report;
  const context = {
    reportId: report.reportId,
    attachmentsBaseUrl: dependencies.attachmentsBaseUrl ?? 'https://issues.stevenclarke.dev',
    reporter: renderReport.reporter ?? null,
  };
  const issueInput: CreateIssueInput = {
    owner,
    repo,
    title: renderIssueTitle(renderReport),
    body: renderIssueBody(renderReport, context),
    labels: renderIssueLabels(intake.labels ?? [], record.category, record.environment),
  };

  let created;
  try {
    created = await client.createIssue(issueInput);
  } catch (error) {
    if (!isUnprocessable(error)) throw new WorkerError('github_failed');
    created = await client.createIssue({
      owner,
      repo,
      title: issueInput.title,
      body: issueInput.body,
    });
  }

  await dependencies.store.markCreated(message.reportId, {
    ...created,
    updatedAt: timestamp,
  });
  logger({ reportId: message.reportId, app: record.app, status: 'created' });
  dependencies.metrics?.increment('worker.report.created');
  return 'created';
};

const itemIdentifier = (record: WorkerSqsRecord, index: number): string =>
  record.messageId ?? `index-${index}`;

export const createWorkerHandler = (dependencies: WorkerDependencies) => {
  return async (event: WorkerEvent): Promise<WorkerResponse> => {
    const batchItemFailures: WorkerResponse['batchItemFailures'] = [];
    const logger = dependencies.logger ?? (() => undefined);

    for (const [index, record] of (event.Records ?? []).entries()) {
      let reportId: string | undefined;
      try {
        const message = sqsMessageSchema.parse(parseJson(record.body));
        reportId = message.reportId;
        await processReport(
          message,
          dependencies,
          (dependencies.now ?? (() => new Date()))().toISOString(),
        );
      } catch (error) {
        const code = error instanceof WorkerError ? error.code : 'internal_error';
        if (reportId) {
          try {
            await dependencies.store.markFailed(
              reportId,
              code,
              (dependencies.now ?? (() => new Date()))().toISOString(),
            );
          } catch {
            batchItemFailures.push({ itemIdentifier: itemIdentifier(record, index) });
            return { batchItemFailures };
          }
        }
        logger({ reportId, status: 'failed', errorCode: code });
        dependencies.metrics?.increment(`worker.report.failed.${code}`);
        batchItemFailures.push({ itemIdentifier: itemIdentifier(record, index) });
      }
    }

    return { batchItemFailures };
  };
};
