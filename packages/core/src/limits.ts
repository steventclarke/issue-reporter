export const REQUEST_BODY_LIMIT_BYTES = 6 * 1024 * 1024;
export const SANITIZED_DATA_LIMIT_BYTES = Math.floor(3.5 * 1024 * 1024);
export const SCREENSHOT_TARGET_BYTES = Math.floor(1.5 * 1024 * 1024);
export const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;

export const LOG_MAX_ENTRIES = 500;
export const LOG_MAX_BYTES = 256 * 1024;
export const STACK_TRACE_MAX_ENTRIES = 10;

export const SUMMARY_MIN_LENGTH = 3;
export const SUMMARY_MAX_LENGTH = 120;
export const DESCRIPTION_MIN_LENGTH = 10;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const EXPECTED_MAX_LENGTH = 2000;
export const CONTACT_MAX_LENGTH = 200;

export const RATE_LIMIT_WINDOW_SECONDS = 3600;
export const RATE_LIMITS = {
  installation: 5,
  ip: 10,
  app: 20,
} as const;

export const GITHUB_BODY_MAX_CHARS = 65_536;
export const RETENTION_DAYS_AFTER_CLOSE = 30;

export const API_VERSION = 'v1';
