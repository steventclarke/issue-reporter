import { FetchError, JwtExpiredError } from 'aws-jwt-verify/error';
import { assertClaimsAllowed, reporterFromClaims, verifyBearerToken } from '../../src/ingest/auth';
import type { IssueIntakeAuthConfig } from '../../config/applications';
import type { VerifiedClaims } from '../../src/ingest/types';

const oidc: Extract<IssueIntakeAuthConfig, { mode: 'oidc' }> = {
  mode: 'oidc',
  issuer: 'https://issuer.example.com',
  audience: 'client-id',
  tokenUse: 'id',
  allowedGroups: ['issue-reporter-beta'],
};

const claims: VerifiedClaims = {
  subject: 'user-123',
  email: 'user@example.com',
  emailVerified: true,
  name: 'User',
  groups: ['issue-reporter-beta'],
};

const verifier = { verify: jest.fn() };

beforeEach(() => verifier.verify.mockReset());

describe('verifyBearerToken', () => {
  it('maps missing and malformed tokens', async () => {
    await expect(verifyBearerToken(undefined, oidc, verifier)).resolves.toEqual({
      ok: false,
      reason: 'missing_token',
    });
    await expect(verifyBearerToken('Token abc', oidc, verifier)).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it('maps expired tokens and IdP outages to metadata-only reasons', async () => {
    verifier.verify.mockRejectedValueOnce(new JwtExpiredError('expired', undefined));
    await expect(verifyBearerToken('Bearer token', oidc, verifier)).resolves.toEqual({
      ok: false,
      reason: 'expired_token',
    });

    verifier.verify.mockRejectedValueOnce(
      new FetchError('https://issuer.example.com/jwks', 'down'),
    );
    await expect(verifyBearerToken('Bearer token', oidc, verifier)).resolves.toEqual({
      ok: false,
      reason: 'auth_unavailable',
    });
  });

  it('rejects claims that do not match an allowlist', async () => {
    verifier.verify.mockResolvedValueOnce({ ...claims, groups: [] });
    await expect(verifyBearerToken('Bearer token', oidc, verifier)).resolves.toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('returns verified claims for an allowed token', async () => {
    verifier.verify.mockResolvedValueOnce(claims);
    await expect(verifyBearerToken('Bearer token', oidc, verifier)).resolves.toEqual({
      ok: true,
      claims,
    });
  });
});

describe('assertClaimsAllowed', () => {
  it('is default-deny with no predicates configured', () => {
    expect(assertClaimsAllowed(claims, { ...oidc, allowedGroups: undefined })).toBe(false);
  });

  it('matches allowed email domains only when email is verified', () => {
    const config = {
      ...oidc,
      allowedGroups: undefined,
      allowedEmailDomains: ['example.com'],
    };
    expect(assertClaimsAllowed(claims, config)).toBe(true);
    expect(assertClaimsAllowed({ ...claims, emailVerified: false }, config)).toBe(false);
  });

  it('matches allowed subjects', () => {
    const config = { ...oidc, allowedGroups: undefined, allowedSubjects: ['user-123'] };
    expect(assertClaimsAllowed(claims, config)).toBe(true);
  });
});

describe('reporterFromClaims', () => {
  const intake = {
    enabled: true,
    environments: ['prod'],
    categories: ['bug'],
    reporterProviders: ['cognito'],
  };

  it('uses verified email and configured provider', () => {
    expect(reporterFromClaims(claims, intake)).toEqual({
      provider: 'cognito',
      subject: 'user-123',
      email: 'user@example.com',
      name: 'User',
    });
  });

  it('drops unverified email', () => {
    expect(reporterFromClaims({ ...claims, emailVerified: false }, intake).email).toBeNull();
  });
});
