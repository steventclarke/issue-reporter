export const REDACTION_MARKER = '[REDACTED]';

const DEFAULT_PATTERN_SOURCES = [
  String.raw`\bgh[pousr]_[A-Za-z0-9]{36,}\b`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}\b`,
  String.raw`\b(?:AKIA|ASIA)[A-Z0-9]{16}\b`,
  String.raw`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`,
  String.raw`\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b`,
  String.raw`-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----`,
  String.raw`\bsk-[A-Za-z0-9_-]{16,}\b`,
  String.raw`\bxoxb-[A-Za-z0-9-]{10,}\b`,
  String.raw`\bAIza[0-9A-Za-z_-]{20,}\b`,
] as const;

export const DEFAULT_REDACTION_PATTERNS: readonly RegExp[] = DEFAULT_PATTERN_SOURCES.map(
  (source) => new RegExp(source, 'gi'),
);

const SENSITIVE_KEY_PATTERN = new RegExp(
  String.raw`(?:token|secret|password|passwd|authorization|api[_-]?key|private[_-]?key|access[_-]?key)`,
  'i',
);

export type RedactionOptions = {
  extraRedactionPatterns?: readonly RegExp[];
};

const cloneWithGlobalFlag = (pattern: RegExp): RegExp =>
  new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

export const isSensitiveKey = (key: string): boolean => SENSITIVE_KEY_PATTERN.test(key);

export function redactString(value: string, options: RedactionOptions = {}): string {
  const patterns = [...DEFAULT_REDACTION_PATTERNS, ...(options.extraRedactionPatterns ?? [])];
  return patterns.reduce(
    (result, pattern) => result.replace(cloneWithGlobalFlag(pattern), REDACTION_MARKER),
    value,
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

const redactValue = (value: unknown, options: RedactionOptions): unknown => {
  if (typeof value === 'string') return redactString(value, options);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, options));
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] =
        isSensitiveKey(key) && item !== null && item !== undefined
          ? REDACTION_MARKER
          : redactValue(item, options);
    }
    return result;
  }
  return value;
};

export function redactReport<T>(input: T, options: RedactionOptions = {}): T {
  return redactValue(input, options) as T;
}
