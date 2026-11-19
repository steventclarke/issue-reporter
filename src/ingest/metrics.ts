import type { Metrics } from './types';

export const createEmfMetrics = (): Metrics => ({
  increment: (name) => {
    process.stdout.write(
      `${JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: 'IssueReporter',
              Dimensions: [[]],
              Metrics: [{ Name: name, Unit: 'Count' }],
            },
          ],
        },
        [name]: 1,
      })}\n`,
    );
  },
});
