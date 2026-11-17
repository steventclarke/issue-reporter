# Issue Reporter — Build Plan

Platform-global in-app issue intake for `stevenclarke.dev`, plus the published
`@issue-reporter/core` and `@issue-reporter/client` packages. Tenant UI work happens in
the tenant repositories (first: `steventclarke/iron-altar`); this repository owns the
backend, the shared contract/redaction code, the client library, and the public endpoint.

- **Status:** Design complete; this plan is awaiting review. No implementation has started.
- **Design authority:** [`docs/issue-reporting-design.md`](docs/issue-reporting-design.md)
  (authoritative) and [`docs/issue-reporting-architecture.md`](docs/issue-reporting-architecture.md)
  (derived diagrams).
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
- **Packages:** `@issue-reporter/core` (Zod contracts, limits, redaction) and
  `@issue-reporter/client` (install ID, transport, typed errors) are published from this
  repository and versioned together. Neither has React, React Native, Expo, or DOM
  dependencies; the Lambda bundles `core` at build time and never imports `client`.
- **Data:** full `DatabaseShape` snapshot, recent logs (500 / 256 KB), 10 stack traces,
  diagnostics, and user text. Only token/secret-like values are redacted; screenshots are
  not auto-redacted and can be removed by the reporter. Viewer IP stays internal for rate
  limiting.
- **Delivery:** client never auto-retries; a manual retry reuses the same `reportId`.
  Ingest is at-most-once from the device; SQS guarantees at-least-once after a successful
  `SendMessage`.
- **Limits:** 6 MB request body, 3.5 MB sanitized data/logs/stack traces, 1.5 MB target /
  3 MB hard max decoded screenshot, 5/10/20 reports per hour for installation/IP/app.
- **Recommended defaults carried into implementation** (confirm at plan review, see
  §7): automatic data on with preview and toggle; one GitHub App installed on selected
  repos; private registry first, public npm on open-sourcing; `/v1` plus a client semver
  major check with opt-out; keep viewer IP out of the public issue.

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
  `summary`, `description`, `expected`, `contact`, `appData`, `diagnostics`, `logs`,
  `stackTraces`, `client`, `screenshot`, `website` (honeypot). Full shapes in design §7.2.
- Responses: `202` accepted/already accepted (`reportId`, `status`), `400` validation,
  `403` forbidden origin, `405` method not allowed, `413` payload too large, `429` rate
  limited (`retryAfterSeconds`), `500` internal. Honeypot hits return a generic `202`.
- CORS origins: `https://iron-altar.stevenclarke.dev`,
  `https://iron-altar-preview.stevenclarke.dev`, `http://localhost:8081`,
  `http://localhost:19006`; methods `POST`, `OPTIONS`; header `content-type`.
- Rate limits use `CloudFront-Viewer-Address` (hashed/raw internally, never published).

## 3. Architecture summary

```text
client -> CloudFront -> Function URL (AWS_IAM + OAC) -> Ingest Lambda
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

### Phase 0: Design and planning — In review

- [x] Write the design document covering client flow, data collection, API contract,
      privacy model, and `IssueIntakeStack`.
- [x] Write architecture, ingest/worker sequence, and report-lifecycle diagrams.
- [x] Write this phased plan with completion checkboxes.
- [x] Duplicate the iron-altar branching and agent guidelines into `AGENTS.md`.
- [ ] Review and approve this plan; confirm the open questions in §7.

### Phase 1: Repository foundation and tooling

- [ ] Initialize the npm workspace root with `packages/core` and `packages/client`.
- [ ] Add strict TypeScript config plus `build`, `typecheck`, `lint`, `format:check`, and
      `test` scripts.
- [ ] Add the test runner configuration and unit-test layout.
- [ ] Add PR CI checks for format, lint, typecheck, test, and build.
- [ ] Add `.gitignore`, `README.md`, and `LICENSE` as appropriate for a releasable repo.
- [ ] Decide the initial package registry (private vs public npm) and record the decision
      here and in `AGENTS.md`.

### Phase 2: Shared core package (`@issue-reporter/core`)

- [ ] Add `contracts.ts`: `IssueReportRequest`, response types, and Zod schemas for app,
      environment, category, text lengths, `DatabaseShape`, diagnostics, logs, stack
      traces, client info, and screenshot.
- [ ] Add `limits.ts`: body/data/screenshot sizes, log and stack-trace counts, rate
      limits, and text-length constants.
- [ ] Add `redaction.ts`: default secret patterns and recursive `redactReport` covering
      user text, app data, logs, and stack traces.
- [ ] Add package `index.ts` exports, `package.json` metadata/exports, and Zod dependency.
- [ ] Add unit tests for schema boundaries, unknown-key stripping, redaction patterns,
      `extraRedactionPatterns`, and tenant overrides.
- [ ] Add contract fixtures shared with the backend validation tests.

### Phase 3: Client package (`@issue-reporter/client`)

- [ ] Add `createIssueReporter(config)` with validation of endpoint, app slug,
      environment, storage adapter, prefix, injected `fetch`, timeout, and extra patterns.
- [ ] Add `submit(input)`: redact, serialize, enforce limits locally, `POST /v1/reports`,
      and map responses to typed results.
- [ ] Add `createReportId()` and `getInstallationId()` backed by the tenant storage
      adapter with `crypto.randomUUID()` fallback generation.
- [ ] Add `IssueReporterError` and response-to-error mapping for every documented status.
- [ ] Add `estimateBase64Bytes` and re-export shared limits and redaction from `core`.
- [ ] Add metadata-only `onDiagnostic` events (`request_started`, `response_received`,
      `rate_limited`); never emit report content.
- [ ] Add unit tests for config validation, request shape, headers, injected `fetch`,
      `AbortController` timeout, each error status, ID generation/reuse, adapter failures,
      redaction, and size limits.
- [ ] Add a bundle test proving no React, React Native, Expo, AsyncStorage, or DOM imports,
      with Node and ESM builds.

### Phase 4: Versioning and publishing

- [ ] Define the coupled versioning scheme for `core`, `client`, and the API major.
- [ ] Add a release workflow publishing `@issue-reporter/core` and
      `@issue-reporter/client` with matching versions to the chosen registry.
- [ ] Add the client's peer/runtime API-major range with a documented opt-out.
- [ ] Verify a dry-run publish and document the tenant upgrade path.

### Phase 5: Ingest Lambda

- [ ] Add the handler skeleton with structured JSON logging (`reportId`, `app`, `status`
      only) and no raw payload logging.
- [ ] Verify origin allowlist (`403`) and HTTP method (`405`).
- [ ] Enforce the 6 MB body limit (`413`) and parse JSON safely.
- [ ] Validate with the shared Zod schemas, strip unknown keys, and return `400` issues.
- [ ] Handle the `website` honeypot: generic `202`, no writes, `honeypot_triggered` metric.
- [ ] Check the existing DynamoDB record first and return the current status for duplicate
      `reportId` values.
- [ ] Enforce installation/IP/app rate limits with atomic `ADD` + TTL and return `429`
      with `retryAfterSeconds`.
- [ ] Reuse `core` redaction on text, app data, logs, and stack traces; drop unscannable
      log lines; fail with `500` before storing on unexpected redaction errors.
- [ ] Serialize sanitized `report.json` and enforce the 3.5 MB data limit.
- [ ] Decode and size-check the screenshot; upload `report.json` and screenshot to the
      documented S3 keys.
- [ ] Write `status = receiving` conditionally, then update to `queued`, then send one SQS
      message (`reportId`, `app`, `environment`) before returning `202`.
- [ ] Roll back the record and uploaded objects on any failure so the client can retry with
      the same `reportId`.
- [ ] Add tests for every field/boundary, redaction, idempotency, honeypot, rate limits,
      screenshot types/sizes, upload contents, rollback, and log privacy.

### Phase 6: Worker Lambda

- [ ] Consume one SQS message at a time with `reportBatchItemFailures: true`.
- [ ] Skip records already `created`; otherwise read `report.json` from S3.
- [ ] Load the GitHub App secret from Secrets Manager, normalize escaped newlines, create
      an Octokit App client, and cache installation tokens in memory.
- [ ] Render the issue body per design §9: sections, full-data and screenshot links,
      app-data summary, diagnostics JSON, logs/stack traces, triage checklist, hidden
      metadata comment, "Disabled by reporter." text, and truncation at GitHub's 65,536
      character limit.
- [ ] Create the issue with title `[iron-altar] <summary>` and config + category +
      environment labels; retry without labels on GitHub `422`.
- [ ] Update DynamoDB with `status = created`, `issueNumber`, `issueUrl`, and `updatedAt`;
      mark unrecoverable failures `failed` and let SQS retry to the DLQ.
- [ ] Add tests with mocked Octokit for success, body links, truncation, label fallback,
      already-created no-op, retry/DLQ behavior, and absence of secrets in logs.

### Phase 7: CDK infrastructure

- [ ] Add `lib/issue-intake-stack.ts` and wire it in `bin/app.ts`; read the four shared SSM
      values (hosted zone, domain, us-east-1 wildcard certificate ARN, alerts topic).
- [ ] Add `config/applications.ts` with `issueIntake` config, build `APP_CONFIG` and allowed
      origins, and publish per-app SSM outputs (`api-url`, `app-id`, `repo`, `labels`).
- [ ] Add `ReportsTable` (on-demand, TTL, AWS-managed encryption, `RETAIN`).
- [ ] Add `AttachmentsBucket` (private, block public access, SSE, TLS enforcement,
      `RETAIN`, abort incomplete multipart uploads).
- [ ] Add `WorkerQueue` (visibility 180 s, retention 4 days, encryption) and `WorkerDlq`
      (retention 14 days, `maxReceiveCount: 5`).
- [ ] Add `IngestFunction` and the `AWS_IAM` Function URL with OAC (Node 22, ARM64,
      512 MB, 10 s).
- [ ] Add `WorkerFunction` (Node 22, ARM64, 512 MB, 30 s) with the SQS event source,
      `batchSize: 1`, and partial batch failures.
- [ ] Add the GitHub App secret with placeholder values at
      `/platform/issue-intake/github-app`.
- [ ] Add the CloudFront distribution: default behavior to the Function URL with OAC,
      `/attachments/*` to S3 with OAC, caching disabled on ingest, allowed methods, HTTPS
      only, TLS 1.2, price class 100, and the four response security headers.
- [ ] Add the Route 53 A/AAAA alias for `issues.stevenclarke.dev`.
- [ ] Add ingest, worker, and DLQ-depth alarms publishing to the platform SNS topic.
- [ ] Tag all resources `project`, `environment`, `owner`, `application`, `managed-by`.
- [ ] Add CDK assertions for Function URL OAC, CloudFront behaviors, S3 privacy, DynamoDB
      TTL, SQS/DLQ, alarms, and SSM outputs; keep `cdk-nag` suppressions narrow and
      documented.
- [ ] Verify `cdk synth`/`cdk diff` with `preview` as the safe default context.

### Phase 8: GitHub and operator setup (manual)

- [ ] Create the GitHub App with `Issues: Read and write` and `Metadata: Read-only`, and
      install it only on `steventclarke/iron-altar`.
- [ ] Store `appId`, `installationId`, and `privateKey` in Secrets Manager; never commit
      them.
- [ ] Create the labels `source:in-app`, `needs-triage`, `app:iron-altar`, `type:*`, and
      `environment:*`.
- [ ] Verify the App can mint an installation token and create a test issue.

### Phase 9: Preview deployment and end-to-end verification

- [ ] Deploy the preview stack (`npx cdk deploy -c environment=preview --all`) and verify
      DNS, TLS, headers, caching, and that the Function URL is not publicly invokable.
- [ ] Submit a report from the preview app; confirm S3 `report.json` + screenshot,
      DynamoDB record, SQS processing, and the GitHub issue with full-data link, logs, and
      stack traces.
- [ ] Resubmit the same `reportId`; confirm no duplicate issue and no S3 rewrite.
- [ ] Exceed a rate limit and confirm `429` with `retryAfterSeconds`.
- [ ] Force a worker failure and confirm the `failed` status, retries, DLQ, and alarm.
- [ ] Confirm logs contain no descriptions, app data, logs, stack traces, contact details,
      screenshots, or private key material.

### Phase 10: Tenant client integration (`steventclarke/iron-altar` repository)

- [ ] Install `@issue-reporter/client`, `expo-file-system`, and
      `react-native-view-shot` with Expo's resolver, and `html2canvas-pro` separately.
- [ ] Add `src/constants/issue-report.ts` with endpoint, app slug, limits, storage adapter,
      environment detection, and redaction overrides.
- [ ] Add `src/lib/screenshot.ts` with native `tmpfile` + resize and web `base64` paths;
      keep screenshot failure non-blocking.
- [ ] Add `src/lib/report-log-buffer.ts` for console and unhandled-error capture (500 / 256 KB
      logs, 10 stack traces, redaction at capture and submission).
- [ ] Add `src/lib/issue-report.ts` for the full `DatabaseShape` snapshot, diagnostics, and
      the configured reporter instance.
- [ ] Add `src/app/report.tsx` with all fields, data preview, public-report notice and
      acknowledgement, screenshot preview/removal, and submission states including retry
      with the same `reportId`.
- [ ] Add the report button to `src/ui/nav-bar.tsx` and register the `report` route, log
      capture, and reporter initialization in `src/app/_layout.tsx`.
- [ ] Add client tests and run format/lint/typecheck/build in the tenant repo.
- [ ] Manually verify web (viewport-only capture, no `expo-file-system` import) and native
      capture in Expo Go, preview, and production.
- [ ] Verify toggle, preview JSON, acknowledgement gating, oversized-report messaging,
      and retry behavior.
- [ ] Verify a library version bump changes only the dependency, not app capture code.

### Phase 11: Production rollout

- [ ] Confirm the §7 open questions and the recommended defaults before release.
- [ ] Deploy the production stack after the required approval; verify the endpoint and
      alarms.
- [ ] Ship the tenant client release and monitor errors, DLQ depth, and incremental cost.
- [ ] Document the triage runbook and where sanitized reports and screenshots are stored.

### Phase 12: Deferred follow-ups (not in the first release)

- [ ] Onboard additional tenants with config + SSM only; confirm no backend code changes
      are needed.
- [ ] Add an S3 lifecycle policy to expire attachments after issue closure or 12 months.
- [ ] Revisit WAF/API Gateway if per-method throttling or usage plans become necessary.
- [ ] Switch to public npm when the repository is open-sourced, keeping names and versions
      unchanged.
- [ ] Revisit screenshot redaction tooling, reporter IP visibility, and web SVG capture
      fidelity based on real reports.

## 6. Cross-repository coordination

- This repository releases `core`/`client`; `iron-altar` consumes a pinned version and does
  not duplicate the contract, redaction, transport, or error mapping.
- Backend phases 1–9 can be built and verified before tenant integration. Phase 10 depends
  on a published client version and a deployed preview endpoint.
- No production deploy before the GitHub App secret is populated (phase 8).
- Tenant repo work follows `../iron-altar/AGENTS.md` (Expo/EAS rules included there).

## 7. Open questions to resolve at review

1. Automatic-data default (recommendation: on, with preview and toggle).
2. Confirm 5/10/20 per-hour rate limits after observing usage.
3. Report retention: indefinite vs expiry after closure / 12 months.
4. Keep optional public contact or switch to GitHub comments.
5. Confirm `[iron-altar] <summary>` title format.
6. One platform GitHub App vs one per tenant (recommendation: one platform app).
7. Alarm thresholds (Lambda errors vs DLQ depth only).
8. Whether preview reports create public issues (design assumes yes).
9. Manual screenshot removal vs crop/redaction tool for v1.
10. Keep viewer IP internal (recommendation) vs include in public report.
11. Accept imperfect web SVG/chart captures for v1.
12. Private registry first vs public npm (recommendation: private first).
13. Client major-version check with opt-out vs `/v1` + server validation only
    (recommendation: both).

## 8. Definition of done

- All phase action items above are checked, with format, lint, typecheck, and tests passing.
- The design's §13 test matrix is covered across packages, Lambdas, CDK, and end-to-end.
- The rollout sequence in design §14 is complete through production with alarms monitored.
