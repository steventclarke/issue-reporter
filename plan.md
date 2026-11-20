# Issue Reporter — Build Plan

Platform-global in-app issue intake for `stevenclarke.dev`, plus the published
`@stevenclarke/issue-reporter-core` and `@stevenclarke/issue-reporter-client` packages. Tenant UI work happens in
the tenant repositories (first: `steventclarke/iron-altar`); this repository owns the
backend, the shared contract/redaction code, the client library, and the public endpoint.

- **Status:** Design complete; Phases 0–4 implemented. Open questions resolved below.
- **Design background:** [`docs/issue-reporting-design.md`](docs/issue-reporting-design.md)
  and [`docs/issue-reporting-architecture.md`](docs/issue-reporting-architecture.md)
  (derived diagrams). This plan is authoritative where review decisions differ (§7).
- **Endpoint:** `POST https://issues.stevenclarke.dev/v1/reports`.
- **Developer guidelines:** [`AGENTS.md`](AGENTS.md) — branching, PR workflow, AWS auth,
  commands, CDK workflow, commit, and plan-tracking conventions.

## 0. Resolved decisions

- **Backend:** one platform-global `IssueIntakeStack`, not one stack per tenant. Tenants
  are enabled through `config/applications.ts` plus SSM parameters.
- **Edge:** CloudFront in front of an `AWS_IAM` Lambda Function URL via OAC;
  `/attachments/*` served from a private S3 bucket via OAC. No API Gateway, no WAF in v1.
- **State:** DynamoDB for report status/idempotency/rate limits (TTL), S3 for
  `report.json` and screenshots, SQS + DLQ for async GitHub issue creation.
- **GitHub:** platform-owned GitHub App with `Issues: Read and write` and
  `Metadata: Read-only`, installed only on `steventclarke/iron-altar`. All created issues
  are public; the client requires an explicit acknowledgement.
- **Packages:** `@stevenclarke/issue-reporter-core` (Zod contracts, limits, redaction) and
  `@stevenclarke/issue-reporter-client` (install ID, transport, typed errors) are published from this
  repository and versioned together. Names use the platform CodeArtifact `@stevenclarke/*` scope.
  Neither has React, React Native, Expo, or DOM dependencies; the Lambda bundles `core` at build
  time and never imports `client`.
- **Data:** full `DatabaseShape` snapshot, recent logs (500 / 256 KB), 10 stack traces,
  diagnostics, and user text. Only token/secret-like values are redacted; screenshots are
  not auto-redacted and can be removed by the reporter. Viewer IP stays internal for rate
  limiting.
- **Delivery:** client never auto-retries; a manual retry reuses the same `reportId`.
  Ingest is at-most-once from the device; SQS guarantees at-least-once after a successful
  `SendMessage`.
- **Limits:** 6 MB request body, 3.5 MB sanitized data/logs/stack traces, 1.5 MB target /
  3 MB hard max decoded screenshot, 5/10/20 reports per hour for installation/IP/app.
- **Review decisions:** automatic data defaults on with preview and toggle; one platform
  GitHub App installed on selected repos; `@stevenclarke/*` packages on the platform
  CodeArtifact repository first, public npm only on open-sourcing; `/v1` plus a client
  semver-major check against `GET /v1/version` with opt-out; viewer IP stays internal.
  Full decision log in §7.
- **Reporter identity:** tenant SSO (Google) supplies the reporter's identity; include it
  in the report and the public issue so the submitter is known. Primary communication
  happens in GitHub comments; the optional `contact` field remains available.
- **Optional SSO auth:** approved design in
  [`docs/issue-reporting-auth-sso-jwt.md`](docs/issue-reporting-auth-sso-jwt.md); per-app
  `auth.mode = 'oidc'` verifies a tenant-issued bearer JWT in ingest and derives `reporter`
  from claims. Anonymous intake remains available for other apps.
- **Retention:** sanitized reports and screenshots expire 30 days after the linked GitHub
  issue is closed (§6.1 and §7).
- **Issue title:** `[<app> v<version>] <summary>`, for example
  `[iron-altar v1.0.0] Rest timer does not start`.
- **Preview:** preview reports create public issues, with version and environment shown in
  each issue.
- **Alarms:** start with Lambda error and DLQ-depth alarms, then validate thresholds
  against real traffic and tune them (Phase 11).
- **App-agnostic core:** no tenant app slugs, environments, categories, providers, database
  shape, or diagnostic fields are hardcoded in `@stevenclarke/issue-reporter-core`; tenants and backend
  config supply their own values and arbitrary JSON snapshots.
- **Screenshots:** manual removal only in v1; no crop/redaction tool.
- **Web capture:** imperfect SVG/chart fidelity accepted for v1.

## 1. Tech stack and repository layout

- TypeScript throughout; npm workspaces for the two publishable packages.
- Zod for the shared contract, Octokit + `@octokit/auth-app` for GitHub, AWS CDK v2
  (TypeScript) for infrastructure, Jest (or the repo's chosen runner) for unit/CDK tests.
- Node 22 / ARM64 Lambdas: ingest 512 MB / 10 s, worker 512 MB / 30 s.
- Planned layout (from design §8.12):

```text
issue-reporter/
  AGENTS.md                    developer guidelines (branching, agents, CDK, tracking)
  plan.md                      this document
  docs/                        design + architecture
  package.json                 workspace root, release tooling
  packages/core/src/           contracts.ts, limits.ts, redaction.ts, index.ts
  packages/client/src/         index.ts, install-id.ts, errors.ts
  lambda/issue-intake/         ingest + worker handlers and helpers
  lib/issue-intake-stack.ts    CDK stack
  bin/app.ts                   CDK app
  config/applications.ts       per-app issueIntake config
  test/                        unit, contract, and CDK assertion tests
```

## 2. API contract summary

- Request fields: `app`, `environment`, `reportId`, `installationId`, `category`,
  `summary`, `description`, `expected`, `contact`, `reporter`, `appData`, `diagnostics`,
  `logs`, `stackTraces`, `client`, `screenshot`, `website` (honeypot). Full shapes in
  design §7.2.
- `reporter` is optional tenant SSO identity (`provider`, `subject`, `email`, `name`)
  supplied by the tenant at submission time. The backend treats it as unverified metadata
  for anonymous apps. For `auth.mode = 'oidc'` apps, ingest overwrites it from verified JWT
  claims; it is never trusted as an authorization control from the client.
- Responses: `202` accepted/already accepted (`reportId`, `status`), `400` validation,
  `401` unauthorized, `403` forbidden/forbidden origin, `405` method not allowed, `413`
  payload too large, `429` rate limited (`retryAfterSeconds`), `500` internal, `503`
  auth unavailable. Error bodies may carry a metadata-only `reason`. Honeypot hits return
  a generic `202`.
- CORS origins: `https://iron-altar.stevenclarke.dev`,
  `https://iron-altar-preview.stevenclarke.dev`, `http://localhost:8081`,
  `http://localhost:19006`; methods `POST`, `OPTIONS`; headers `content-type` and
  `authorization`.
- Rate limits use `CloudFront-Viewer-Address` (hashed/raw internally, never published).

## 3. Architecture summary

```text
client + SSO token -> CloudFront -> Function URL (AWS_IAM + OAC) -> Ingest Lambda
                                                                   |-> DynamoDB (status, idempotency, limits)

                                                                   |-> S3 (report.json, screenshot)
                                                                   `-> SQS -> Worker Lambda -> GitHub App -> issue

                          CloudFront /attachments/* -> S3 (OAC, no Lambda)
```

Report lifecycle: `receiving -> queued -> created`, with `failed` and DLQ paths; duplicate
`reportId` returns the existing status; ingest failures roll back the record and objects.
See the diagrams in `docs/issue-reporting-architecture.md` for sequences and trust bounds.

## 4. Conventions

Work is done on phase branches with PRs to `main` per [`AGENTS.md`](AGENTS.md). Every
implementation commit on a phase branch updates the checkboxes below; a phase's heading is
marked **Completed** when its PR is opened. Run format, lint, typecheck, and tests before
declaring any phase done.

## 5. Phases and action items

### Phase 0: Design and planning — Completed

- [x] Write the design document covering client flow, data collection, API contract,
      privacy model, and `IssueIntakeStack`.
- [x] Write architecture, ingest/worker sequence, and report-lifecycle diagrams.
- [x] Write this phased plan with completion checkboxes.
- [x] Duplicate the iron-altar branching and agent guidelines into `AGENTS.md`.
- [x] Review the plan and resolve the open questions in §7.

### Phase 1: Repository foundation and tooling — Completed

- [x] Initialize the npm workspace root with `packages/core` and `packages/client`.
- [x] Add strict TypeScript config plus `build`, `typecheck`, `lint`, `format:check`, and
      `test` scripts.
- [x] Add the test runner configuration and unit-test layout.
- [x] Add PR CI checks for format, lint, typecheck, test, and build.
- [x] Add `.gitignore`, `README.md`, and `LICENSE` as appropriate for a releasable repo.
- [x] Configure publishing to the platform CodeArtifact repository and document the SSO
      login setup required by tenant consumers.

### Phase 2: Shared core package (`@stevenclarke/issue-reporter-core`) — Completed

- [x] Add `contracts.ts`: `IssueReportRequest`, response types, and Zod schemas for app,
      environment, category, text lengths, optional `reporter` SSO identity, `DatabaseShape`,
      diagnostics, logs, stack traces, client info, and screenshot.
- [x] Add `limits.ts`: body/data/screenshot sizes, log and stack-trace counts, rate
      limits, and text-length constants.
- [x] Add `redaction.ts`: default secret patterns and recursive `redactReport` covering
      user text, app data, logs, and stack traces.
- [x] Add package `index.ts` exports, `package.json` metadata/exports, and Zod dependency.
- [x] Add unit tests for schema boundaries, unknown-key stripping, redaction patterns,
      `extraRedactionPatterns`, and tenant overrides.
- [x] Add contract fixtures shared with the backend validation tests.

### Phase 3: Client package (`@stevenclarke/issue-reporter-client`) — Completed

- [x] Add `createIssueReporter(config)` with validation of endpoint, app slug,
      environment, storage adapter, prefix, injected `fetch`, timeout, and extra patterns.
- [x] Add `submit(input)`: redact, serialize, enforce limits locally, `POST /v1/reports`,
      and map responses to typed results.
- [x] Add `createReportId()` and `getInstallationId()` backed by the tenant storage
      adapter with `crypto.randomUUID()` fallback generation.
- [x] Add `IssueReporterError` and response-to-error mapping for every documented status,
      including `401` unauthorized, `403` forbidden, and `503` auth unavailable with
      metadata-only `reason` codes.
- [x] Add optional `auth.getBearerToken()` config that attaches an SSO bearer token header,
      omits the header when no token is available, and fails locally when the provider throws.
- [x] Add `estimateBase64Bytes` and re-export shared limits and redaction from `core`.
- [x] Add metadata-only `onDiagnostic` events (`request_started`, `response_received`,
      `rate_limited`, `auth_required`, `auth_failed`); never emit report content, tokens, or
      raw claims.
- [x] Add unit tests for config validation, request shape, headers, injected `fetch`,
      `AbortController` timeout, each error status, bearer-token header/null/throw behavior,
      auth diagnostics, ID generation/reuse, adapter failures, redaction, and size limits.
- [x] Add a bundle test proving no React, React Native, Expo, AsyncStorage, or DOM imports,
      with Node and ESM builds.

### Phase 4: Versioning and publishing — Completed

- [x] Define the coupled versioning scheme for `@stevenclarke/issue-reporter-core`,
      `@stevenclarke/issue-reporter-client`, and the API major: root/core/client versions match,
      the major equals `API_MAJOR`, and the endpoint stays `/v{major}`.
- [x] Add a release workflow in the `production` GitHub environment publishing both packages
      with matching versions to the platform CodeArtifact repository using short-lived
      OIDC/CodeArtifact tokens.
- [x] Keep the `/v1` path and add a client semver-major check against `GET /v1/version`, with
      `skipApiVersionCheck: true` as the documented opt-out.
- [x] Verify a dry-run publish with `npm run release:check` / workflow dispatch and document the
      tenant upgrade path in the README and design docs.

### Phase 5: Ingest Lambda — Completed

- [x] Add the handler skeleton with structured JSON logging (`reportId`, `app`, `status`
      only) and no raw payload logging.
- [x] Verify origin allowlist (`403`) and HTTP method (`405`).
- [x] For `auth.mode = 'oidc'`, verify the SSO bearer JWT against the configured issuer/JWKS,
      audience, expiry, token use, and group/domain/subject allowlist before any side effects.
- [x] Overwrite `reporter` from verified claims and rate-limit authenticated apps by subject.
- [x] Return metadata-only `401`/`403`/`503` auth failures with `reason` codes; never log tokens
      or raw claims.
- [x] Enforce the 6 MB body limit (`413`) and parse JSON safely.
- [x] Validate with the shared Zod schemas, strip unknown keys, and return `400` issues.
- [x] Handle the `website` honeypot: generic `202`, no writes, `honeypot_triggered` metric.
- [x] Check the existing DynamoDB record first and return the current status for duplicate
      `reportId` values.
- [x] Enforce installation/IP/app rate limits with atomic `ADD` + TTL and return `429`
      with `retryAfterSeconds`.
- [x] Reuse `core` redaction on text, app data, logs, and stack traces; drop unscannable
      log lines; fail with `500` before storing on unexpected redaction errors.
- [x] Serialize sanitized `report.json` and enforce the 3.5 MB data limit.
- [x] Decode and size-check the screenshot; upload `report.json` and screenshot to the
      documented S3 keys.
- [x] Write `status = receiving` conditionally, then update to `queued`, then send one SQS
      message (`reportId`, `app`, `environment`) before returning `202`.
- [x] Roll back the record and uploaded objects on any failure so the client can retry with
      the same `reportId`.
- [x] Add tests for every field/boundary, redaction, idempotency, honeypot, rate limits,
      screenshot types/sizes, upload contents, rollback, and log privacy.

### Phase 6: Worker Lambda — Completed

- [x] Consume one SQS message at a time with `reportBatchItemFailures: true`.
- [x] Skip records already `created`; otherwise read `report.json` from S3.
- [x] Load the GitHub App secret from Secrets Manager, normalize escaped newlines, create
      an Octokit App client, and cache installation tokens in memory.
- [x] Render the issue body per design §9, plus a Reporter section with SSO identity when
      supplied: sections, full-data and screenshot links, app-data summary, diagnostics
      JSON, logs/stack traces, triage checklist, hidden metadata comment, "Disabled by
      reporter." text, and truncation at GitHub's 65,536 character limit. Show app version
      and environment prominently in the Client section for both prod and preview.
- [x] Create the issue with title `[<app> v<version>] <summary>` (from `client.version`,
      falling back to diagnostics version or `unknown`) and config + category +
      environment labels; retry without labels on GitHub `422`.
- [x] Update DynamoDB with `status = created`, `issueNumber`, `issueUrl`, and `updatedAt`;
      mark unrecoverable failures `failed` and let SQS retry to the DLQ.
- [x] Add tests with mocked Octokit for success, versioned title, reporter identity,
      version/environment in body, body links, truncation, label fallback, already-created
      no-op, retry/DLQ behavior, and absence of secrets in logs.

### Phase 6.1: Attachment retention — Completed

- [x] Add a daily scheduled retention handler in `lambda/issue-intake/` that finds reports
      with `status = created`, checks the linked GitHub issue state via the App token, and
      records the closure date (idempotently) when the issue is closed.
- [x] Tag the S3 objects for closed reports so an S3 lifecycle rule expires them 30 days
      after closure; leave reports with open issues untouched.
- [x] Clear the optional DynamoDB `ttl`/closure metadata consistently with attachment
      expiry; never delete the record before the objects expire.
- [x] Add tests for open vs closed issues, idempotent closure tagging, 30-day expiry
      configuration, and missing GitHub issue/secret handling.

### Phase 7: CDK infrastructure — Completed

- [x] Add `lib/issue-intake-stack.ts` and wire it in `bin/app.ts`; read the four shared SSM
      values (hosted zone, domain, us-east-1 wildcard certificate ARN, alerts topic).
- [x] Add `config/applications.ts` with `issueIntake` config, build `APP_CONFIG` and allowed
      origins, and publish per-app SSM outputs (`api-url`, `app-id`, `repo`, `labels`).
- [x] Add `ReportsTable` (on-demand, TTL, AWS-managed encryption, `RETAIN`).
- [x] Add `AttachmentsBucket` (private, block public access, SSE, TLS enforcement,
      `RETAIN`, abort incomplete multipart uploads).
- [x] Add an S3 lifecycle rule expiring objects tagged with the closure marker 30 days
      after the tag date (Phase 6.1).
- [x] Add an EventBridge daily schedule invoking the retention handler with least-privilege
      permissions.
- [x] Add `WorkerQueue` (visibility 180 s, retention 4 days, encryption) and `WorkerDlq`
      (retention 14 days, `maxReceiveCount: 5`).
- [x] Add `IngestFunction` and the `AWS_IAM` Function URL with OAC (Node 22, ARM64,
      512 MB, 10 s).
- [x] Add `WorkerFunction` (Node 22, ARM64, 512 MB, 30 s) with the SQS event source,
      `batchSize: 1`, and partial batch failures.
- [x] Add the GitHub App secret with placeholder values at
      `/platform/issue-intake/github-app`.
- [x] Add the CloudFront distribution: default behavior to the Function URL with OAC,
      `/attachments/*` to S3 with OAC, caching disabled on ingest, allowed methods, HTTPS
      only, TLS 1.2, price class 100, and the four response security headers.
- [x] Add the Route 53 A/AAAA alias for `issues.stevenclarke.dev`.
- [x] Add ingest, worker, and DLQ-depth alarms publishing to the platform SNS topic
      (initial defaults: Lambda `Errors` > 0 over 5 minutes, DLQ depth > 0 over 5 minutes).
- [x] Tag all resources `project`, `environment`, `owner`, `application`, `managed-by`.
- [x] Add CDK assertions for Function URL OAC, CloudFront behaviors, S3 privacy, DynamoDB
      TTL, SQS/DLQ, alarms, and SSM outputs; keep `cdk-nag` suppressions narrow and
      documented.
- [x] Verify `cdk synth`/`cdk diff` with `preview` as the safe default context.

### Phase 8: GitHub and operator setup (manual) — Completed

- [x] Create the GitHub App with `Issues: Read and write` and `Metadata: Read-only`, and
      install it only on `steventclarke/iron-altar`.
- [x] Store the GitHub App credentials in each target account/region as one JSON secret at
      `/platform/issue-intake/github-app` with keys `appId`, `installationId`, and
      `privateKey`; never commit them.
- [x] Create the labels `source:in-app`, `state:needs-triage`, `app:iron-altar`, `type:bug`,
      `type:feature`, `type:other`, `environment:prod`, `environment:preview`, and
      `environment:dev`.
- [x] Restrict the shared `Category` enumeration to `bug | feature | other` and bump the coupled
      core/client version to 1.1.0.
- [x] Accept GitHub App private keys with real newlines, escaped `\n` sequences, or
      space-separated PEM text.
- [x] Verify the App can mint an installation token and create a test issue.

### Phase 9: Preview deployment and end-to-end verification

- [ ] Deploy the preview stack (`npx cdk deploy -c environment=preview --all`) and verify
      DNS, TLS, headers, caching, and that the Function URL is not publicly invokable.
- [ ] Submit a report from the preview app; confirm S3 `report.json` + screenshot,
      DynamoDB record, SQS processing, and the GitHub issue with full-data link, logs, and
      stack traces.
- [ ] Confirm the preview issue is public, titled `[iron-altar v<version>] <summary>`, and
      clearly indicates environment and version; verify reporter identity when SSO is wired.
- [ ] Close a test issue and verify the retention handler tags attachments and the
      lifecycle rule is configured for 30-day expiry (check the computed expiry date).
- [ ] Resubmit the same `reportId`; confirm no duplicate issue and no S3 rewrite.
- [ ] Exceed a rate limit and confirm `429` with `retryAfterSeconds`.
- [ ] Force a worker failure and confirm the `failed` status, retries, DLQ, and alarm.
- [ ] Confirm logs contain no descriptions, app data, logs, stack traces, contact details,
      screenshots, or private key material.

### Phase 10: Tenant client integration (`steventclarke/iron-altar` repository)

- [ ] Install `@stevenclarke/issue-reporter-client`, `expo-file-system`, and
      `react-native-view-shot` with Expo's resolver, and `html2canvas-pro` separately;
      configure tenant CI/dev auth for the private package registry.
- [ ] Add `src/constants/issue-report.ts` with endpoint, app slug, limits, storage adapter,
      environment detection, and redaction overrides.
- [ ] Wire Google SSO identity into the reporter config/submit input (`reporter` fields)
      when the tenant SSO work lands; omit the field when identity is unavailable.
- [ ] Add `src/lib/screenshot.ts` with native `tmpfile` + resize and web `base64` paths;
      keep screenshot failure non-blocking.
- [ ] Add `src/lib/report-log-buffer.ts` for console and unhandled-error capture (500 / 256 KB
      logs, 10 stack traces, redaction at capture and submission).
- [ ] Add `src/lib/issue-report.ts` for the full `DatabaseShape` snapshot, diagnostics, and
      the configured reporter instance.
- [ ] Add `src/app/report.tsx` with all fields, data preview, public-report notice and
      acknowledgement (including reporter identity and public contact), screenshot
      preview/removal, and submission states including retry with the same `reportId`.
- [ ] Add the report button to `src/ui/nav-bar.tsx` and register the `report` route, log
      capture, and reporter initialization in `src/app/_layout.tsx`.
- [ ] Add client tests and run format/lint/typecheck/build in the tenant repo.
- [ ] Manually verify web (viewport-only capture, no `expo-file-system` import) and native
      capture in Expo Go, preview, and production.
- [ ] Verify toggle, preview JSON, acknowledgement gating, oversized-report messaging,
      and retry behavior.
- [ ] Verify SSO identity, version, and environment appear in a created issue and that
      GitHub comments are the primary follow-up channel.
- [ ] Verify a library version bump changes only the dependency, not app capture code.

### Phase 11: Production rollout

- [ ] Deploy the production stack after the required approval; verify the endpoint and
      alarms.
- [ ] Validate the initial alarm thresholds (Lambda errors, DLQ depth) against real
      traffic after rollout; tune and record the results in this plan.
- [ ] Review the 5/10/20 per-hour rate limits after observing real usage; adjust if
      needed.
- [ ] Ship the tenant client release and monitor errors, DLQ depth, and incremental cost.
- [ ] Document the triage runbook and where sanitized reports and screenshots are stored.

### Phase 12: Deferred follow-ups (not in the first release)

- [ ] Onboard additional tenants with config + SSM only and the one platform GitHub App
      installed on their repositories; confirm no backend code changes are needed.
- [ ] Revisit WAF/API Gateway if per-method throttling or usage plans become necessary.
- [ ] Switch from the private registry to public npm when the repository is open-sourced,
      keeping names and versions unchanged.
- [ ] Revisit the 30-day retention window and manual screenshot policy if real reports
      demand it.

## 6. Cross-repository coordination

- This repository releases `core`/`client`; `iron-altar` consumes a pinned version and does
  not duplicate the contract, redaction, transport, or error mapping.
- Backend phases 1–9 (including 6.1) can be built and verified before tenant integration.
  Phase 10 depends on a published client version and a deployed preview endpoint.
- Reporter identity in Phase 10 depends on tenant-side Google SSO; if it is not ready, ship
  with `reporter` omitted and add it in a follow-up client release.
- No production deploy before the GitHub App secret is populated (phase 8).
- Tenant repo work follows `../iron-altar/AGENTS.md` (Expo/EAS rules included there).

## 7. Decision log from plan review

These answers supersede the corresponding recommendations in design §15; where this plan
and the design document differ, this plan is authoritative.

| #   | Decision                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Automatic data and diagnostics default **on**, with preview and toggle.                                                                                                |
| 2   | Keep the initial 5/10/20 per-hour limits; validate against real usage in Phase 11.                                                                                     |
| 3   | Expire sanitized reports and screenshots **30 days after the linked issue is closed** (Phase 6.1).                                                                     |
| 4   | Include tenant Google SSO reporter identity in the report and public issue; GitHub comments are the primary follow-up channel. Keep the optional public contact field. |
| 5   | Title issues `[<app> v<version>] <summary>` using `client.version` (fallback: diagnostics version or `unknown`).                                                       |
| 6   | One platform-owned GitHub App installed on selected tenant repositories.                                                                                               |
| 7   | Start with Lambda error and DLQ-depth alarms, then validate thresholds against real traffic and tune them (Phase 11).                                                  |
| 8   | Preview reports do create public issues; version and environment must be visible in each issue.                                                                        |
| 9   | Manual screenshot removal only; no crop/redaction tool in v1.                                                                                                          |
| 10  | Keep viewer IP internal for rate limiting; never include it in the public report.                                                                                      |
| 11  | Accept imperfect web SVG/chart captures for v1.                                                                                                                        |
| 12  | Publish to the platform CodeArtifact repository first; public npm only when the repository is open-sourced.                                                            |
| 13  | Use both the `/v1` path and a client semver-major check against the deployed API major, with a documented opt-out.                                                     |

## 8. Definition of done

- All phase action items above are checked, with format, lint, typecheck, and tests passing.
- The design's §13 test matrix is covered across packages, Lambdas, CDK, and end-to-end.
- Reporter identity, versioned issue titles, and 30-day post-closure retention are verified.
- Alarm thresholds and rate limits have been validated against real traffic (Phase 11).
- The rollout sequence in design §14 is complete through production with alarms monitored.
