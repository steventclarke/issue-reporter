import { REDACTION_MARKER, SANITIZED_DATA_LIMIT_BYTES } from '@stevenclarke/issue-reporter-core';
import { sanitizeLogs, sanitizeReport, SanitizationError } from '../../src/ingest/sanitize';
import { cloneValidReportRequest, secretBearingReportRequest } from '../fixtures/issue-report';

describe('sanitizeReport', () => {
  it('redacts secrets and excludes screenshot data from report.json', () => {
    const result = sanitizeReport(secretBearingReportRequest());
    const stored = JSON.parse(result.reportJson) as Record<string, unknown>;

    expect(JSON.stringify(stored)).not.toContain('ghp_');
    expect(JSON.stringify(stored)).not.toContain('AKIA');
    expect(stored.summary).toContain(REDACTION_MARKER);
    expect(stored.screenshot).toEqual({ contentType: 'image/jpeg' });
    expect(JSON.stringify(stored)).not.toContain('dataBase64');
    expect(new TextDecoder().decode(result.screenshotBytes!)).toBe('/fake jpeg bytes');
  });

  it('uses the png extension for png screenshots', () => {
    const request = cloneValidReportRequest();
    request.screenshot = { contentType: 'image/png', dataBase64: 'aGVsbG8=' };

    expect(sanitizeReport(request).screenshotExtension).toBe('png');
  });

  it('rejects reports whose sanitized JSON exceeds the data limit', () => {
    const request = cloneValidReportRequest();
    request.appData = 'x'.repeat(SANITIZED_DATA_LIMIT_BYTES);

    expect(() => sanitizeReport(request)).toThrow(SanitizationError);
  });

  it('rejects screenshots above the decoded limit', () => {
    const request = cloneValidReportRequest();
    request.screenshot = {
      contentType: 'image/jpeg',
      dataBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64'),
    };

    expect(() => sanitizeReport(request)).toThrow(new SanitizationError('screenshot'));
  });
});

describe('sanitizeLogs', () => {
  it('drops log entries that cannot be scanned', () => {
    const badEntry = {} as Record<string, unknown>;
    Object.defineProperty(badEntry, 'message', {
      enumerable: true,
      get: () => {
        throw new Error('unscannable');
      },
    });
    const goodEntry = {
      timestamp: '2026-11-19T12:00:00.000Z',
      level: 'info',
      message: 'safe',
    };

    expect(sanitizeLogs([badEntry as never, goodEntry as never])).toEqual([goodEntry]);
  });
});
