export const estimateBase64Bytes = (value: string): number => {
  const commaIndex = value.indexOf(',');
  const base64 = (
    commaIndex >= 0 && value.slice(0, commaIndex).startsWith('data:')
      ? value.slice(commaIndex + 1)
      : value
  ).replace(/\s/g, '');
  const padding = /={1,2}$/.exec(base64)?.[0].length ?? 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};
