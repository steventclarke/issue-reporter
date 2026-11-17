import { createReportId } from './report-id';

export type StorageAdapter = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const normalizeStorageKeyPrefix = (prefix?: string): string => {
  if (!prefix) return 'issue-reporter/';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
};

export const installationStorageKey = (prefix?: string): string =>
  `${normalizeStorageKeyPrefix(prefix)}installation-id`;

export const getInstallationId = async (
  storage: StorageAdapter,
  key = installationStorageKey(),
): Promise<string> => {
  const stored = await storage.get(key);
  if (typeof stored === 'string' && UUID_PATTERN.test(stored)) return stored;

  const generated = createReportId();
  await storage.set(key, generated);
  return generated;
};
