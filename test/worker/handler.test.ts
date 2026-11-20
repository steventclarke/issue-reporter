import { createWorkerHandler } from '../../src/worker/handler';
import { baseRecord, baseReport, createMocks, createdIssue, reportId, sqsBody } from './helpers';

const event = (body = sqsBody, messageId = 'msg-1') => ({
  Records: [{ messageId, body }],
});

describe('worker handler', () => {
  it('creates a GitHub issue and stores the result', async () => {
    const mocks = createMocks();
    const handler = createWorkerHandler(mocks.dependencies);

    const result = await handler(event());

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mocks.store.getReport).toHaveBeenCalledWith(reportId);
    expect(mocks.secrets.getGithubAppSecret).toHaveBeenCalledTimes(1);
    expect(mocks.githubClientFactory).toHaveBeenCalledTimes(1);
    expect(mocks.client.createIssue).toHaveBeenCalledTimes(1);
    expect(mocks.client.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'steventclarke',
        repo: 'iron-altar',
        title: '[iron-altar v1.2.3] Workout screen freezes after saving',
        labels: expect.arrayContaining(['app:iron-altar', 'type:bug', 'environment:prod']),
      }),
    );
    expect(mocks.store.markCreated).toHaveBeenCalledWith(reportId, {
      ...createdIssue,
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('retries issue creation without labels on a 422', async () => {
    const mocks = createMocks();
    mocks.client.createIssue
      .mockRejectedValueOnce({ status: 422 })
      .mockResolvedValueOnce(createdIssue);
    const handler = createWorkerHandler(mocks.dependencies);

    await handler(event());

    expect(mocks.client.createIssue).toHaveBeenCalledTimes(2);
    expect(mocks.client.createIssue.mock.calls[1]?.[0]).not.toHaveProperty('labels');
    expect(mocks.store.markCreated).toHaveBeenCalledTimes(1);
  });

  it('ignores reports already created', async () => {
    const mocks = createMocks();
    mocks.store.getReport.mockResolvedValueOnce({ ...baseRecord, status: 'created' });
    const handler = createWorkerHandler(mocks.dependencies);

    const result = await handler(event());

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mocks.client.createIssue).not.toHaveBeenCalled();
    expect(mocks.store.markCreated).not.toHaveBeenCalled();
    expect(mocks.metrics.increment).toHaveBeenCalledWith('worker.report.ignored');
  });

  it('marks GitHub failures as failed and returns a batch item failure', async () => {
    const mocks = createMocks();
    mocks.client.createIssue.mockRejectedValueOnce({ status: 500 });
    const handler = createWorkerHandler(mocks.dependencies);

    const result = await handler(event());

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
    expect(mocks.store.markFailed).toHaveBeenCalledWith(
      reportId,
      'github_failed',
      '2026-01-02T03:04:05.000Z',
    );
    expect(mocks.metrics.increment).toHaveBeenCalledWith('worker.report.failed.github_failed');
  });

  it('marks invalid stored reports as failed without calling GitHub', async () => {
    const mocks = createMocks();
    mocks.attachments.getReportJson.mockResolvedValueOnce('{not json');
    const handler = createWorkerHandler(mocks.dependencies);

    const result = await handler(event());

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
    expect(mocks.store.markFailed).toHaveBeenCalledWith(
      reportId,
      'report_invalid',
      '2026-01-02T03:04:05.000Z',
    );
    expect(mocks.client.createIssue).not.toHaveBeenCalled();
  });

  it('returns a batch item failure for malformed queue messages', async () => {
    const mocks = createMocks();
    const handler = createWorkerHandler(mocks.dependencies);

    const result = await handler(event('not-json', 'msg-bad'));

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-bad' }] });
    expect(mocks.store.getReport).not.toHaveBeenCalled();
  });

  it('reports failures per item in a batch', async () => {
    const mocks = createMocks();
    const secondBody = JSON.stringify({ app: 'iron-altar', environment: 'prod' });
    const handler = createWorkerHandler(mocks.dependencies);

    const result = await handler({
      Records: [
        { messageId: 'msg-ok', body: sqsBody },
        { messageId: 'msg-bad', body: secondBody },
      ],
    });

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-bad' }] });
    expect(mocks.client.createIssue).toHaveBeenCalledTimes(1);
  });

  it('logs only metadata and never secrets or report content', async () => {
    const mocks = createMocks();
    const handler = createWorkerHandler(mocks.dependencies);

    await handler(event());

    const logs = JSON.stringify(mocks.logger.mock.calls);
    expect(logs).not.toContain('PRIVATE KEY');
    expect(logs).not.toContain(baseReport.description);
    expect(logs).not.toContain(baseReport.reporter?.email ?? '');
  });
});
