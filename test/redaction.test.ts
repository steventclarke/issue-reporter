import {
  DEFAULT_REDACTION_PATTERNS,
  isSensitiveKey,
  REDACTION_MARKER,
  redactReport,
  redactString,
} from '@steventclarke/issue-reporter-core';
import { secretBearingReportRequest } from './fixtures/issue-report';

const githubToken = `ghp_${'a'.repeat(36)}`;
const fineGrainedGithubToken = `github_pat_${'b'.repeat(30)}`;
const awsAccessKey = 'AKIAIOSFODNN7EXAMPLE';
const awsSessionKey = 'ASIAIOSFODNN7EXAMPLE';
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
const bearer = `Bearer ${'c'.repeat(32)}`;
const pem =
  '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END RSA PRIVATE KEY-----';
const openAiKey = `sk-${'d'.repeat(32)}`;
const slackToken = `xoxb-${'e'.repeat(24)}`;
const googleApiKey = `AIza${'f'.repeat(35)}`;

describe('redactString', () => {
  it.each([
    ['GitHub token', githubToken],
    ['fine-grained GitHub token', fineGrainedGithubToken],
    ['AWS access key', awsAccessKey],
    ['AWS session key', awsSessionKey],
    ['JWT', jwt],
    ['Bearer value', bearer],
    ['PEM private key', pem],
    ['OpenAI-style key', openAiKey],
    ['Slack token', slackToken],
    ['Google API key', googleApiKey],
  ])('redacts a %s', (_name, secret) => {
    expect(redactString(`prefix ${secret} suffix`)).toBe(`prefix ${REDACTION_MARKER} suffix`);
  });

  it('redacts every occurrence without leaking regex state between calls', () => {
    const value = `${githubToken} and ${githubToken}`;
    const expected = `${REDACTION_MARKER} and ${REDACTION_MARKER}`;

    expect(redactString(value)).toBe(expected);
    expect(redactString(value)).toBe(expected);
  });

  it('supports tenant-specific patterns', () => {
    const value = 'tenant-ref-123456 is internal';

    expect(redactString(value, { extraRedactionPatterns: [/tenant-ref-\d+/i] })).toBe(
      `${REDACTION_MARKER} is internal`,
    );
    expect(redactString(value)).toBe(value);
  });

  it('exposes the shared pattern preset', () => {
    expect(DEFAULT_REDACTION_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('isSensitiveKey', () => {
  it.each(['token', 'accessToken', 'api_key', 'apiKey', 'secret', 'password', 'Authorization'])(
    'matches %s',
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    },
  );

  it.each(['summary', 'route', 'name'])('does not match %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('redactReport', () => {
  it('redacts sensitive object keys and nested strings without mutating input', () => {
    const input = {
      token: githubToken,
      summary: `made with ${awsAccessKey}`,
      nested: [{ password: 'hunter2', apiKey: openAiKey, keep: 'visible text' }],
      count: 3,
    };
    const original = JSON.stringify(input);

    const redacted = redactReport(input);

    expect(redacted.token).toBe(REDACTION_MARKER);
    expect(redacted.summary).toBe(`made with ${REDACTION_MARKER}`);
    expect(redacted.nested[0]).toEqual({
      password: REDACTION_MARKER,
      apiKey: REDACTION_MARKER,
      keep: 'visible text',
    });
    expect(redacted.count).toBe(3);
    expect(JSON.stringify(input)).toBe(original);
  });

  it('applies tenant patterns throughout a report', () => {
    const redacted = redactReport(
      { summary: 'tenant-ref-123456', logs: [{ message: 'tenant-ref-654321' }] },
      { extraRedactionPatterns: [/tenant-ref-\d+/] },
    );

    expect(JSON.stringify(redacted)).not.toContain('tenant-ref-');
  });

  it('redacts secrets in the shared report fixture', () => {
    const redacted = redactReport(secretBearingReportRequest());
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain('ghp_');
    expect(serialized).not.toContain('AKIA');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('eyJ');
    const appData = redacted.appData as { records: unknown[] } | null | undefined;
    expect(appData?.records).toHaveLength(1);
    expect(redacted.logs).toHaveLength(1);
    expect(redacted.stackTraces).toHaveLength(1);
  });
});
