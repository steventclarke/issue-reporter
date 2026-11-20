import type {
  Category,
  ClientInfo,
  LogEntry,
  ReporterIdentity,
  StackTraceEntry,
} from '@stevenclarke/issue-reporter-core';
import type { RenderContext, StoredReport } from './types';

export const GITHUB_BODY_MAX_CHARS = 65_536;
const LOG_PREVIEW_COUNT = 100;
const STACK_TRACE_PREVIEW_COUNT = 10;
const APP_DATA_SUMMARY_LIMIT = 20;

const disabledText = (value: unknown): string =>
  value === null ? 'Disabled by reporter.' : 'Not provided.';

const inlineValue = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (value === null) return 'none';
  if (Array.isArray(value)) return `${value.length} entries`;
  if (typeof value === 'object') return null;
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim().slice(0, 120) || 'empty';
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const titleCaseKey = (key: string): string => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

const appDataLines = (value: unknown, depth = 0): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return [];
  const lines: string[] = [];

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const label = titleCaseKey(key);
    const scalar = inlineValue(entry);
    if (scalar !== null) {
      lines.push(`${'  '.repeat(depth)}- ${label}: ${scalar}`);
      continue;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      lines.push(`${'  '.repeat(depth)}- ${label}:`);
      lines.push(...appDataLines(entry, depth + 1));
    }
  }

  return lines;
};

const clientLines = (client: ClientInfo, app: string, environment: string): string[] => {
  const build = client.build ? ` (build ${client.build})` : ' (build unknown)';
  const platform = client.osVersion ? `${client.platform} ${client.osVersion}` : client.platform;
  return [
    `- App: ${app}`,
    `- Environment: ${environment}`,
    `- Version: ${client.version}${build}`,
    `- Platform: ${platform}`,
    `- Device: ${client.device ?? 'unknown'}`,
    `- Route: ${client.route}`,
  ];
};

const reporterLines = (reporter: ReporterIdentity | null): string[] => {
  if (!reporter) return ['Not provided.'];
  return [
    `- Provider: ${reporter.provider}`,
    `- Subject: \`${reporter.subject}\``,
    `- Email: ${reporter.email ?? 'Not provided'}`,
    `- Name: ${reporter.name ?? 'Not provided'}`,
  ];
};

const jsonBlock = (value: string): string => `\`\`\`json\n${value}\n\`\`\``;

const detailsBlock = (summary: string, value: string): string =>
  ['<details>', `<summary>${summary}</summary>`, '', jsonBlock(value), '', '</details>'].join('\n');

const safeVersion = (value: string): string =>
  value
    .replace(/[\r\n\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'unknown';

export const renderIssueTitle = (report: StoredReport): string => {
  const summary = report.summary.replace(/\s+/g, ' ').trim().slice(0, 200);
  const diagnosticVersion = report.diagnostics?.version;
  const version =
    report.client?.version ||
    (typeof diagnosticVersion === 'string' ? diagnosticVersion : '') ||
    'unknown';
  return `[${report.app} v${safeVersion(version)}] ${summary}`;
};

export const renderIssueLabels = (
  appLabels: readonly string[],
  category: Category,
  environment: string,
): string[] => [
  ...new Set([
    'source:in-app',
    'state:needs-triage',
    ...appLabels,
    `type:${category}`,
    `environment:${environment}`,
  ]),
];

const buildSections = (
  report: StoredReport,
  context: RenderContext,
  logs: LogEntry[],
  stackTraces: StackTraceEntry[],
  notice: string | null,
): string => {
  const reportUrl = `${context.attachmentsBaseUrl}/attachments/reports/${report.app}/${report.reportId}/report.json`;
  const screenshotExtension = report.screenshot?.contentType === 'image/png' ? 'png' : 'jpg';
  const screenshotUrl = `${context.attachmentsBaseUrl}/attachments/reports/${report.app}/${report.reportId}/screenshot.${screenshotExtension}`;
  const appDataSummary = appDataLines(report.appData).slice(0, APP_DATA_SUMMARY_LIMIT);
  const client = clientLines(report.client, report.app, report.environment);

  const sections: Array<[string, string]> = [
    ['## What happened', report.description],
    ['## What was expected', report.expected?.trim() || 'Not provided.'],
    ['## Contact', report.contact?.trim() || 'Not provided.'],
    ['## Reporter', reporterLines(context.reporter).join('\n')],
    ['## Client', client.join('\n')],
    ['## Full report data', `[report.json](${reportUrl})`],
  ];

  if (report.appData === null || report.appData === undefined) {
    sections.push(['## App data', disabledText(report.appData)]);
  } else {
    sections.push([
      '## App data',
      [
        ...(appDataSummary.length ? appDataSummary : ['No app-data summary available.']),
        '',
        'The complete tenant app-data snapshot is in `report.json`.',
      ].join('\n'),
    ]);
  }

  sections.push([
    '## Diagnostics',
    report.diagnostics === null || report.diagnostics === undefined
      ? disabledText(report.diagnostics)
      : jsonBlock(JSON.stringify(report.diagnostics, null, 2)),
  ]);

  sections.push([
    '## Recent logs',
    report.logs === null || report.logs === undefined
      ? disabledText(report.logs)
      : detailsBlock(`Last ${logs.length} log entries`, JSON.stringify(logs, null, 2)),
  ]);

  sections.push([
    '## Stack traces',
    report.stackTraces === null || report.stackTraces === undefined
      ? disabledText(report.stackTraces)
      : detailsBlock(
          `Last ${stackTraces.length} unhandled errors`,
          JSON.stringify(stackTraces, null, 2),
        ),
  ]);

  if (report.screenshot) {
    sections.push(['## Screenshot', `![Screenshot](${screenshotUrl})`]);
  }

  sections.push([
    '## Triage',
    [
      '- [ ] Reproduce',
      '- [ ] Identify root cause',
      '- [ ] Add regression coverage',
      '- [ ] Fix and verify',
    ].join('\n'),
  ]);

  if (notice) sections.push(['## Body truncation', notice]);

  return sections.map(([heading, content]) => `## ${heading.slice(3)}\n\n${content}`).join('\n\n');
};

const hiddenMetadata = (report: StoredReport): string =>
  `<!-- issue-report:v1 ${JSON.stringify({
    reportId: report.reportId,
    installationId: report.installationId,
    app: report.app,
    environment: report.environment,
  })} -->`;

const finalizeBody = (body: string, report: StoredReport): string => {
  const suffix = `\n\n${hiddenMetadata(report)}`;
  const limit = GITHUB_BODY_MAX_CHARS - suffix.length;
  if (body.length <= limit) return `${body}${suffix}`;
  return `${body.slice(0, Math.max(0, limit - 1)).trimEnd()}…${suffix}`;
};

export const renderIssueBody = (report: StoredReport, context: RenderContext): string => {
  let logs = report.logs ? report.logs.slice(-LOG_PREVIEW_COUNT) : [];
  let stackTraces = report.stackTraces ? report.stackTraces.slice(-STACK_TRACE_PREVIEW_COUNT) : [];
  let notice: string | null = null;

  const build = () => buildSections(report, context, logs, stackTraces, notice);
  const hiddenLength = hiddenMetadata(report).length + 2;
  const trimmedNotice =
    'Inline logs and stack traces were trimmed to fit GitHub’s body limit. See report.json for the full data.';

  if (build().length + hiddenLength > GITHUB_BODY_MAX_CHARS && logs.length > 0) {
    notice = trimmedNotice;
  }
  while (build().length + hiddenLength > GITHUB_BODY_MAX_CHARS && logs.length > 0) {
    logs = logs.slice(0, -1);
  }
  if (build().length + hiddenLength > GITHUB_BODY_MAX_CHARS && stackTraces.length > 0) {
    notice = trimmedNotice;
  }
  while (build().length + hiddenLength > GITHUB_BODY_MAX_CHARS && stackTraces.length > 0) {
    stackTraces = stackTraces.slice(0, -1);
  }

  if (build().length + hiddenLength > GITHUB_BODY_MAX_CHARS) {
    notice =
      'Inline logs and stack traces were omitted due to GitHub’s body limit. See report.json for the full data.';
    return finalizeBody(build(), report);
  }

  return finalizeBody(build(), report);
};
