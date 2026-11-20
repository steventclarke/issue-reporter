import type { LogEntry } from '@stevenclarke/issue-reporter-core';
import {
  GITHUB_BODY_MAX_CHARS,
  renderIssueBody,
  renderIssueLabels,
  renderIssueTitle,
} from '../../src/worker/render';
import { baseReport, reportId } from './helpers';

const context = {
  reportId,
  attachmentsBaseUrl: 'https://issues.stevenclarke.dev',
  reporter: baseReport.reporter ?? null,
};

describe('worker issue rendering', () => {
  it('uses the app and client version in the title', () => {
    expect(renderIssueTitle(baseReport)).toBe(
      '[iron-altar v1.2.3] Workout screen freezes after saving',
    );
  });

  it('renders version, environment, reporter, and links in prod', () => {
    const body = renderIssueBody(baseReport, context);

    expect(body).toContain('- App: iron-altar');
    expect(body).toContain('- Environment: prod');
    expect(body).toContain('- Version: 1.2.3 (build 42)');
    expect(body).toContain('cognito-sub-123');
    expect(body).toContain(
      `[report.json](https://issues.stevenclarke.dev/attachments/reports/iron-altar/${reportId}/report.json)`,
    );
    expect(body).toContain('<!-- issue-report:v1');
  });

  it('renders preview environment and screenshot extension', () => {
    const report = {
      ...baseReport,
      environment: 'preview',
      screenshot: { contentType: 'image/png' as const },
    };
    const body = renderIssueBody(report, { ...context, reporter: null });

    expect(body).toContain('- Environment: preview');
    expect(body).toContain(
      `![Screenshot](https://issues.stevenclarke.dev/attachments/reports/iron-altar/${reportId}/screenshot.png)`,
    );
    expect(body).toContain('Not provided.');
  });

  it('marks disabled automatic data clearly', () => {
    const report = {
      ...baseReport,
      appData: null,
      diagnostics: null,
      logs: null,
      stackTraces: null,
    };
    const body = renderIssueBody(report, context);

    expect(body.match(/Disabled by reporter\./g)).toHaveLength(4);
  });

  it('truncates oversized inline data while preserving the report link', () => {
    const logs: LogEntry[] = Array.from({ length: 400 }, (_, index) => ({
      timestamp: '2026-01-02T03:00:00.000Z',
      level: 'error',
      message: `failure-${index}-${'x'.repeat(500)}`,
      context: { index },
    }));
    const body = renderIssueBody({ ...baseReport, logs }, context);

    expect(body.length).toBeLessThanOrEqual(GITHUB_BODY_MAX_CHARS);
    expect(body).toContain('## Body truncation');
    expect(body).toContain(`/attachments/reports/iron-altar/${reportId}/report.json`);
    expect(body.trimEnd().endsWith('-->')).toBe(true);
  });

  it('builds labels from base, app, category, and environment', () => {
    expect(renderIssueLabels(['app:iron-altar'], 'bug', 'preview')).toEqual([
      'source:in-app',
      'state:needs-triage',
      'app:iron-altar',
      'type:bug',
      'environment:preview',
    ]);
  });

  it.each(['bug', 'feature', 'other'] as const)('uses the %s type label', (category) => {
    expect(renderIssueLabels([], category, 'dev')).toContain(`type:${category}`);
  });
});
