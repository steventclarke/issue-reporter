import { applications } from '../../config/applications';
import { createGithubClientFactory } from '../worker/github';
import type { GithubClientFactory } from '../worker/types';
import type { RetentionDependencies, RetentionFailureCode, RetentionReportRecord } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const noopLogger = (): void => undefined;

const reportIdFromPk = (pk: string): string => pk.replace(/^REPORT#/, '');

const closureDates = (
  now: Date,
  retentionDays: number,
): { closureDate: string; attachmentExpiryDate: string; ttl: number } => {
  const closureDate = now.toISOString().slice(0, 10);
  const attachmentExpiryDate = new Date(now.getTime() + retentionDays * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  return {
    closureDate,
    attachmentExpiryDate,
    ttl: Math.floor(Date.parse(`${attachmentExpiryDate}T00:00:00.000Z`) / 1000),
  };
};

const issueFailureCode = (error: unknown): RetentionFailureCode => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 404
  ) {
    return 'issue_missing';
  }
  return 'issue_unavailable';
};

export const createRetentionHandler = (dependencies: RetentionDependencies) => {
  const logger = dependencies.logger ?? noopLogger;
  const metrics = dependencies.metrics;
  const now = dependencies.now ?? (() => new Date());
  const configuredApplications = dependencies.applications ?? applications;
  const githubClientFactory: GithubClientFactory =
    dependencies.githubClientFactory ?? createGithubClientFactory();
  const retentionDays = dependencies.retentionDays ?? 30;

  return async (): Promise<void> => {
    const reports = await dependencies.store.scanCreatedReports();
    if (reports.length === 0) return;

    let secret;
    try {
      secret = await dependencies.secrets.getGithubAppSecret();
    } catch {
      logger({ status: 'failed', errorCode: 'secret_unavailable' });
      await metrics?.increment('retention.secret.unavailable');
      return;
    }

    const client = githubClientFactory(secret);

    for (const report of reports) {
      await processReport(report);
    }

    async function processReport(report: RetentionReportRecord): Promise<void> {
      const reportId = reportIdFromPk(report.pk);
      const log = (errorCode?: RetentionFailureCode, status: 'failed' | 'ignored' = 'ignored') =>
        logger({ reportId, app: report.app, status, errorCode });

      if (report.closureDate) return;
      if (!report.issueNumber) {
        log('issue_missing');
        await metrics?.increment('retention.issue.missing');
        return;
      }

      const config = configuredApplications.find(
        (item) => item.name === report.app && item.issueIntake?.enabled !== false,
      );
      const [owner, repo] = config?.repo.split('/') ?? [];
      if (!owner || !repo) {
        log('app_unknown');
        await metrics?.increment('retention.app.unknown');
        return;
      }

      let state;
      try {
        state = await client.getIssue({ owner, repo, issueNumber: report.issueNumber });
      } catch (error) {
        const errorCode = issueFailureCode(error);
        log(errorCode, 'failed');
        await metrics?.increment(`retention.issue.${errorCode}`);
        return;
      }

      if (state.state === 'open') return;

      const dates = closureDates(now(), retentionDays);
      try {
        await dependencies.attachments.tagForClosure(
          report.reportKey,
          dates.closureDate,
          dates.attachmentExpiryDate,
        );
        if (report.screenshotKey) {
          await dependencies.attachments.tagForClosure(
            report.screenshotKey,
            dates.closureDate,
            dates.attachmentExpiryDate,
          );
        }
      } catch {
        log('tagging_failed', 'failed');
        await metrics?.increment('retention.tagging.failed');
        return;
      }

      const updated = await dependencies.store.markClosed(reportId, {
        ...dates,
        updatedAt: now().toISOString(),
      });
      if (!updated) return;

      logger({ reportId, app: report.app, status: report.status });
      await metrics?.increment('retention.report.closed');
    }
  };
};
