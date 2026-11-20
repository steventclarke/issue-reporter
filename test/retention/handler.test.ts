import { createRetentionHandler } from '../../src/retention/handler';
import { createMocks, createdReport, reportId } from './helpers';

const expectedTtl = Math.floor(Date.parse('2026-02-01T00:00:00.000Z') / 1000);

describe('createRetentionHandler', () => {
  it('tags closed report attachments and records closure metadata', async () => {
    const mocks = createMocks();

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.client.getIssue).toHaveBeenCalledWith({
      owner: 'steventclarke',
      repo: 'iron-altar',
      issueNumber: 42,
    });
    expect(mocks.attachments.tagForClosure).toHaveBeenNthCalledWith(
      1,
      createdReport.reportKey,
      '2026-01-02',
      '2026-02-01',
    );
    expect(mocks.attachments.tagForClosure).toHaveBeenNthCalledWith(
      2,
      createdReport.screenshotKey,
      '2026-01-02',
      '2026-02-01',
    );
    expect(mocks.store.markClosed).toHaveBeenCalledWith(reportId, {
      closureDate: '2026-01-02',
      attachmentExpiryDate: '2026-02-01',
      ttl: expectedTtl,
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
    expect(mocks.logger).toHaveBeenCalledWith({
      reportId,
      app: 'iron-altar',
      status: 'created',
    });
    expect(mocks.metrics.increment).toHaveBeenCalledWith('retention.report.closed');
  });

  it('leaves reports with open issues untouched', async () => {
    const mocks = createMocks();
    mocks.client.getIssue.mockResolvedValue({ state: 'open' });

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.client.getIssue).toHaveBeenCalledTimes(1);
    expect(mocks.attachments.tagForClosure).not.toHaveBeenCalled();
    expect(mocks.store.markClosed).not.toHaveBeenCalled();
  });

  it('skips already closed reports without checking GitHub', async () => {
    const mocks = createMocks([
      { ...createdReport, closureDate: '2026-01-01', attachmentExpiryDate: '2026-01-31' },
    ]);

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.client.getIssue).not.toHaveBeenCalled();
    expect(mocks.attachments.tagForClosure).not.toHaveBeenCalled();
    expect(mocks.store.markClosed).not.toHaveBeenCalled();
  });

  it('logs missing issue metadata and skips the report', async () => {
    const report = { ...createdReport };
    delete report.issueNumber;
    const mocks = createMocks([report]);

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.client.getIssue).not.toHaveBeenCalled();
    expect(mocks.logger).toHaveBeenCalledWith({
      reportId,
      app: 'iron-altar',
      status: 'ignored',
      errorCode: 'issue_missing',
    });
    expect(mocks.metrics.increment).toHaveBeenCalledWith('retention.issue.missing');
  });

  it('handles a GitHub issue that no longer exists', async () => {
    const mocks = createMocks();
    mocks.client.getIssue.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.logger).toHaveBeenCalledWith({
      reportId,
      app: 'iron-altar',
      status: 'failed',
      errorCode: 'issue_missing',
    });
    expect(mocks.attachments.tagForClosure).not.toHaveBeenCalled();
    expect(mocks.store.markClosed).not.toHaveBeenCalled();
  });

  it('handles an unavailable GitHub App secret', async () => {
    const mocks = createMocks();
    mocks.secrets.getGithubAppSecret.mockRejectedValue(new Error('no secret'));

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.logger).toHaveBeenCalledWith({
      status: 'failed',
      errorCode: 'secret_unavailable',
    });
    expect(mocks.client.getIssue).not.toHaveBeenCalled();
    expect(mocks.attachments.tagForClosure).not.toHaveBeenCalled();
    expect(mocks.store.markClosed).not.toHaveBeenCalled();
  });

  it('uses the configured retention period instead of the default', async () => {
    const mocks = createMocks([], { retentionDays: 7 });
    mocks.store.scanCreatedReports.mockResolvedValue([createdReport]);

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.attachments.tagForClosure).toHaveBeenCalledWith(
      createdReport.reportKey,
      '2026-01-02',
      '2026-01-09',
    );
    expect(mocks.store.markClosed).toHaveBeenCalledWith(
      reportId,
      expect.objectContaining({
        attachmentExpiryDate: '2026-01-09',
        ttl: Math.floor(Date.parse('2026-01-09T00:00:00.000Z') / 1000),
      }),
    );
  });

  it('does not record closure metadata when object tagging fails', async () => {
    const mocks = createMocks();
    mocks.attachments.tagForClosure.mockRejectedValue(new Error('copy failed'));

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.logger).toHaveBeenCalledWith({
      reportId,
      app: 'iron-altar',
      status: 'failed',
      errorCode: 'tagging_failed',
    });
    expect(mocks.store.markClosed).not.toHaveBeenCalled();
  });

  it('skips reports from unknown apps', async () => {
    const mocks = createMocks([{ ...createdReport, app: 'unknown-app' }]);

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.logger).toHaveBeenCalledWith({
      reportId,
      app: 'unknown-app',
      status: 'ignored',
      errorCode: 'app_unknown',
    });
    expect(mocks.client.getIssue).not.toHaveBeenCalled();
    expect(mocks.store.markClosed).not.toHaveBeenCalled();
  });

  it('does nothing when there are no open reports', async () => {
    const mocks = createMocks([]);

    await createRetentionHandler(mocks.dependencies)();

    expect(mocks.secrets.getGithubAppSecret).not.toHaveBeenCalled();
    expect(mocks.client.getIssue).not.toHaveBeenCalled();
    expect(mocks.store.markClosed).not.toHaveBeenCalled();
  });
});
