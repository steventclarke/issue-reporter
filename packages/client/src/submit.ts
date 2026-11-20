import {
  API_MAJOR,
  API_VERSION,
  LOG_MAX_BYTES,
  REQUEST_BODY_LIMIT_BYTES,
  SANITIZED_DATA_LIMIT_BYTES,
  SCREENSHOT_MAX_BYTES,
  acceptedReportResponseSchema,
  apiVersionResponseSchema,
  issueReportRequestSchema,
  redactReport,
  type AcceptedReportResponse,
  type AuthFailureReason,
  type IssueReportRequest,
} from '@stevenclarke/issue-reporter-core';
import { estimateBase64Bytes } from './base64';
import {
  validateConfig,
  type FetchResponse,
  type IssueReporterConfig,
  type IssueReporterDiagnostic,
  type ResolvedConfig,
} from './config';
import { errorFromResponse, IssueReporterError } from './errors';
import { getInstallationId } from './install-id';
import { createReportId } from './report-id';

type ReportPayload = Omit<
  IssueReportRequest,
  'app' | 'environment' | 'installationId' | 'reportId'
>;

export type ReportSubmission = ReportPayload & { reportId?: string };

export type IssueReporterSuccess = {
  ok: true;
  reportId: string;
  status: AcceptedReportResponse['status'];
};

export type IssueReporterFailure = {
  ok: false;
  reportId: string;
  error: IssueReporterError;
};

export type IssueReporterResult = IssueReporterSuccess | IssueReporterFailure;

export type IssueReporter = {
  submit(input: ReportSubmission): Promise<IssueReporterResult>;
  getInstallationId(): Promise<string>;
};

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (value: number, bits: number): number =>
  ((value >>> bits) | (value << (32 - bits))) >>> 0;

export const sha256Hex = (message: string): string => {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;
  const paddingLength = (56 - ((bytes.length + 1) % 64) + 64) % 64;
  const paddedLength = bytes.length + 1 + paddingLength + 8;
  const data = new Uint8Array(paddedLength);
  const view = new DataView(data.buffer);
  data.set(bytes);
  data[bytes.length] = 0x80;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const small0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const small1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16]! + small0 + words[index - 7]! + small1) >>> 0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;

    for (let index = 0; index < 64; index += 1) {
      const big1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + big1 + choice + SHA256_K[index]! + words[index]!) >>> 0;
      const big0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (big0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }

  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
};

const issuePath = (issue: unknown): string => {
  const path = (issue as { path?: unknown })?.path;
  if (!Array.isArray(path) || path.length === 0) return 'root';
  return path.map(String).join('.');
};

const emitDiagnostic = (config: ResolvedConfig, event: IssueReporterDiagnostic): void => {
  if (!config.onDiagnostic) return;
  try {
    config.onDiagnostic(event);
  } catch {
    return;
  }
};

const authFailureReason = (error: IssueReporterError): AuthFailureReason => {
  if (error.reason) return error.reason;
  if (error.code === 'unauthorized') return 'invalid_token';
  if (error.code === 'forbidden') return 'not_allowed';
  return 'auth_unavailable';
};

const enforceLimits = (request: IssueReportRequest, body: string): void => {
  const dataBytes = utf8ByteLength(
    JSON.stringify({
      appData: request.appData,
      diagnostics: request.diagnostics,
      logs: request.logs,
      stackTraces: request.stackTraces,
    }),
  );
  if (dataBytes > SANITIZED_DATA_LIMIT_BYTES) {
    throw new IssueReporterError('payload_too_large', 'Report data exceeds the size limit', {
      part: 'data',
    });
  }

  const logsBytes = utf8ByteLength(JSON.stringify(request.logs ?? []));
  if (logsBytes > LOG_MAX_BYTES) {
    throw new IssueReporterError('payload_too_large', 'Report logs exceed the size limit', {
      part: 'logs',
    });
  }

  if (request.screenshot) {
    const screenshotBytes = estimateBase64Bytes(request.screenshot.dataBase64);
    if (screenshotBytes > SCREENSHOT_MAX_BYTES) {
      throw new IssueReporterError('payload_too_large', 'Screenshot exceeds the size limit', {
        part: 'screenshot',
      });
    }
  }

  if (utf8ByteLength(body) > REQUEST_BODY_LIMIT_BYTES) {
    throw new IssueReporterError('payload_too_large', 'Report request exceeds the size limit', {
      part: 'request',
    });
  }
};

export const createIssueReporter = (config: IssueReporterConfig): IssueReporter => {
  const resolved = validateConfig(config);

  const loadInstallationId = async (): Promise<string> => {
    try {
      return await getInstallationId(resolved.storage, resolved.installationKey);
    } catch {
      throw new IssueReporterError('validation', 'Unable to load the installation ID');
    }
  };

  let apiVersionChecked = false;
  let apiVersionMismatch: IssueReporterError | null = null;
  const checkApiVersion = async (): Promise<void> => {
    if (resolved.skipApiVersionCheck || apiVersionChecked) {
      if (apiVersionMismatch) throw apiVersionMismatch;
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolved.timeoutMs);
    try {
      const response = await resolved.fetch(`${resolved.endpoint}/${API_VERSION}/version`, {
        method: 'GET',
        headers: {},
        signal: controller.signal,
      });
      if (response.status !== 200) {
        apiVersionChecked = true;
        return;
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        apiVersionChecked = true;
        return;
      }

      const parsed = apiVersionResponseSchema.safeParse(responseBody);
      if (!parsed.success) {
        apiVersionChecked = true;
        return;
      }

      if (parsed.data.apiMajor !== API_MAJOR || parsed.data.apiVersion !== API_VERSION) {
        apiVersionChecked = true;
        apiVersionMismatch = new IssueReporterError(
          'api_version_mismatch',
          'The client and report API versions are incompatible',
          {
            status: response.status,
            apiMajor: parsed.data.apiMajor,
            expectedApiMajor: API_MAJOR,
          },
        );
        emitDiagnostic(resolved, {
          event: 'api_version_mismatch',
          apiMajor: parsed.data.apiMajor,
          expectedApiMajor: API_MAJOR,
        });
        throw apiVersionMismatch;
      }

      apiVersionChecked = true;
    } catch (error) {
      if (error instanceof IssueReporterError && error.code === 'api_version_mismatch') throw error;
      apiVersionChecked = true;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    getInstallationId: loadInstallationId,

    submit: async (input: ReportSubmission): Promise<IssueReporterResult> => {
      const reportId = input.reportId ?? createReportId();

      try {
        await checkApiVersion();
        const sanitized = redactReport(input, {
          extraRedactionPatterns: resolved.extraRedactionPatterns,
        });
        const installationId = await loadInstallationId();
        const candidate: IssueReportRequest = {
          ...sanitized,
          app: resolved.app,
          environment: resolved.environment,
          installationId,
          reportId,
          website: sanitized.website ?? '',
        };
        const parsed = issueReportRequestSchema.safeParse(candidate);
        if (!parsed.success) {
          throw new IssueReporterError('validation', 'Report failed local validation', {
            issues: parsed.error.issues.map(issuePath),
          });
        }

        const request = parsed.data;
        const body = JSON.stringify(request);
        enforceLimits(request, body);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-amz-content-sha256': sha256Hex(body),
        };
        if (resolved.auth) {
          emitDiagnostic(resolved, { event: 'auth_required', reportId });
          let token: string | null;
          try {
            token = await resolved.auth.getBearerToken();
          } catch {
            emitDiagnostic(resolved, {
              event: 'auth_failed',
              reportId,
              reason: 'token_provider_failed',
            });
            throw new IssueReporterError('unauthorized', 'Unable to load the SSO token', {
              reason: 'token_provider_failed',
            });
          }
          if (typeof token === 'string' && token.trim() !== '') {
            headers.Authorization = `Bearer ${token.trim()}`;
          }
        }

        emitDiagnostic(resolved, { event: 'request_started', reportId });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), resolved.timeoutMs);
        let response: FetchResponse;
        try {
          response = await resolved.fetch(`${resolved.endpoint}/${API_VERSION}/reports`, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal,
          });
        } catch {
          throw new IssueReporterError(
            'network',
            controller.signal.aborted ? 'Request timed out' : 'Network request failed',
          );
        } finally {
          clearTimeout(timer);
        }

        emitDiagnostic(resolved, { event: 'response_received', reportId, status: response.status });

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          throw new IssueReporterError('server', 'Invalid response body', {
            status: response.status,
          });
        }

        if (response.status === 202) {
          const accepted = acceptedReportResponseSchema.safeParse(responseBody);
          if (!accepted.success) {
            throw new IssueReporterError('server', 'Invalid accepted response', { status: 202 });
          }
          return {
            ok: true,
            reportId: accepted.data.reportId,
            status: accepted.data.status,
          };
        }

        const error = errorFromResponse(response.status, responseBody);
        if (error.code === 'rate_limited') {
          emitDiagnostic(resolved, {
            event: 'rate_limited',
            reportId,
            status: response.status,
            retryAfterSeconds: error.retryAfterSeconds,
          });
        }
        if (
          error.code === 'unauthorized' ||
          error.code === 'forbidden' ||
          error.code === 'auth_unavailable'
        ) {
          emitDiagnostic(resolved, {
            event: 'auth_failed',
            reportId,
            status: response.status,
            reason: authFailureReason(error),
          });
        }
        throw error;
      } catch (error) {
        const issueError =
          error instanceof IssueReporterError
            ? error
            : new IssueReporterError('server', 'Unexpected client error');
        return { ok: false, reportId, error: issueError };
      }
    },
  };
};
