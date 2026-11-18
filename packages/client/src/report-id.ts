export const createReportId = (): string => {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl || typeof cryptoImpl.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is unavailable');
  }
  return cryptoImpl.randomUUID();
};
