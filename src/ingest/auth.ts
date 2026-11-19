import { JwtVerifier } from 'aws-jwt-verify';
import { FailedAssertionError, FetchError, JwtExpiredError } from 'aws-jwt-verify/error';
import type { AuthFailureReason, ReporterIdentity } from '@stevenclarke/issue-reporter-core';
import type { IssueIntakeAuthConfig, IssueIntakeConfig } from '../../config/applications';
import type {
  TokenVerifier,
  TokenVerifierFactory,
  VerificationResult,
  VerifiedClaims,
} from './types';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;

const normalizeClaims = (payload: Record<string, unknown>): VerifiedClaims => {
  const subject = asString(payload.sub);
  if (!subject) throw new FailedAssertionError('Missing subject', undefined);
  return {
    subject,
    email: asString(payload.email),
    emailVerified: payload.email_verified === true,
    name: asString(payload.name),
    groups: asStringArray(payload['cognito:groups']),
  };
};

export const createTokenVerifier: TokenVerifierFactory = (auth) => {
  if (auth.mode !== 'oidc') throw new Error('OIDC verifier requires oidc auth config');
  const verifier = JwtVerifier.create({
    issuer: auth.issuer,
    audience: auth.audience,
    graceSeconds: auth.clockToleranceSeconds ?? 60,
    customJwtCheck: ({ payload }) => {
      if (payload.token_use !== auth.tokenUse) {
        throw new FailedAssertionError('Invalid token_use', undefined, auth.tokenUse);
      }
      normalizeClaims(payload as Record<string, unknown>);
    },
  });
  return {
    verify: async (token) =>
      normalizeClaims((await verifier.verify(token)) as Record<string, unknown>),
  };
};

const reasonForError = (error: unknown): AuthFailureReason => {
  if (error instanceof JwtExpiredError) return 'expired_token';
  if (error instanceof FetchError) return 'auth_unavailable';
  return 'invalid_token';
};

export const assertClaimsAllowed = (
  claims: VerifiedClaims,
  auth: Extract<IssueIntakeAuthConfig, { mode: 'oidc' }>,
): boolean => {
  const groupMatch =
    auth.allowedGroups && claims.groups
      ? auth.allowedGroups.some((group) => claims.groups?.includes(group))
      : false;
  const domainMatch =
    auth.allowedEmailDomains && claims.emailVerified && claims.email
      ? auth.allowedEmailDomains.some((domain) =>
          claims.email?.toLowerCase().endsWith(`@${domain.toLowerCase()}`),
        )
      : false;
  const subjectMatch = auth.allowedSubjects ? auth.allowedSubjects.includes(claims.subject) : false;
  return groupMatch || domainMatch || subjectMatch;
};

export const verifyBearerToken = async (
  authorization: string | undefined,
  auth: Extract<IssueIntakeAuthConfig, { mode: 'oidc' }>,
  verifier: TokenVerifier,
): Promise<VerificationResult> => {
  if (!authorization) return { ok: false, reason: 'missing_token' };
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match?.[1]) return { ok: false, reason: 'invalid_token' };

  let claims: VerifiedClaims;
  try {
    claims = await verifier.verify(match[1]);
  } catch (error) {
    return { ok: false, reason: reasonForError(error) };
  }
  if (!assertClaimsAllowed(claims, auth)) return { ok: false, reason: 'not_allowed' };
  return { ok: true, claims };
};

export const reporterFromClaims = (
  claims: VerifiedClaims,
  app: IssueIntakeConfig,
): ReporterIdentity => ({
  provider: app.reporterProviders[0] ?? 'sso',
  subject: claims.subject,
  email: claims.emailVerified ? (claims.email ?? null) : null,
  name: claims.name ?? null,
});
