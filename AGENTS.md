# AGENTS.md

Working conventions for this repository.

## Project

This is the **platform-global issue intake backend** for `stevenclarke.dev`. It owns the
`issues.stevenclarke.dev` CloudFront endpoint, the ingest and worker Lambdas, DynamoDB
report state, S3 attachments, SQS/DLQ, the GitHub App secret, and the CloudWatch alarms.
It also publishes the reusable `@stevenclarke/issue-reporter-core` and `@stevenclarke/issue-reporter-client`
packages. Tenant UI code (report form, screenshot capture, app-data snapshot, logging) lives
in tenant repositories such as `steventclarke/iron-altar`; follow that repository's
`AGENTS.md` for Expo/EAS rules when working on tenant integration.

Shared AWS foundation (Route 53 zone, wildcard certificate, GitHub OIDC, deploy roles,
CodeArtifact npm repository, monitoring topic) is owned by `stevenclarke-infrastructure`. This
repository reads those values from SSM and never creates shared DNS, certificate, artifact,
or role resources. Published packages use the platform `@stevenclarke/*` scope.

## Branching and PR workflow

Follow this process for all changes:

1. **Start from `main`**

   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create a phase/feature branch**
   - For plan phases: `phase/<n>` or `phase/<n>-<description>` (e.g., `phase/5-ingest`)
   - For issue-driven work: `<issue-number>-<description>` (e.g., `12-fix-label-fallback`)
   - For ad-hoc work: a short descriptive branch name

   ```bash
   git checkout -b phase/5-ingest
   ```

3. **Make changes and commit**

   ```bash
   git add <files>
   git commit -m "Concise description of changes"
   ```

4. **Push and open a PR**

   ```bash
   git push -u origin phase/5-ingest
   gh pr create --base main --head phase/5-ingest \
     --title "Phase 5: Ingest" \
     --body "Describe changes, link to plan items, and note any follow-ups."
   ```

5. **Address review comments**, push updates, then merge after approval and passing checks.

6. **Merge and clean up**

   ```bash
   git checkout main
   git pull origin main
   git branch -d phase/5-ingest
   ```

## Branches

- `main` — production. Merges require approval via the `production` GitHub Environment.
- `preview` — integration branch for staging deploys, when used.
- `phase/<n>` or `phase/<n>-<description>` — plan-phase work (e.g., `phase/5-ingest`).
- `<issue-number>-<description>` — issue-driven work.

## AWS authentication

Use IAM Identity Center SSO with profile `admin`:

```bash
aws sso login --profile admin
export AWS_PROFILE=admin  # set in ~/.zshrc
aws sts get-caller-identity
```

Tokens expire periodically; re-run `aws sso login` as needed. Primary region is
`us-east-2`; CloudFront certificates live in `us-east-1`.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npm install
npm run build                              # workspace packages + CDK
npm test                                   # unit, contract, and CDK assertion tests
npm run format:check
npm run lint
npm run typecheck
```

Run `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm test` before
declaring any task done.

## CDK workflow (application infrastructure)

Infrastructure lives in `lib/issue-intake-stack.ts` and `bin/app.ts` and reads shared
values from SSM (hosted-zone ID, domain name, wildcard certificate ARN, alerts topic ARN)
rather than hardcoding them. The app uses the platform's existing CDK bootstrap and never
runs `cdk bootstrap` itself.

```bash
npm run build
npm test
npx cdk synth -c environment=preview       # or -c environment=prod
npx cdk diff -c environment=preview
npx cdk deploy -c environment=preview --all
```

- Use `-c environment=preview|prod` to select the target. Default to `preview` for safety
  when deploying from the workstation.
- Tag all resources `project`, `environment`, `owner`, `application`, `managed-by`.
- Use platform deploy roles via GitHub OIDC in CI; do not store long-lived AWS keys.
- `cdk synth` runs `cdk-nag` via the CDK policy validation framework; keep the
  acknowledgments narrow and documented.

## Code conventions

- TypeScript with npm workspaces for `@stevenclarke/issue-reporter-core` and `@stevenclarke/issue-reporter-client`.
- Zod for the shared contract; Octokit for GitHub; AWS CDK v2 (TypeScript) for
  infrastructure.
- `core` has no platform dependencies beyond Zod. `client` has no React, React Native,
  Expo, AsyncStorage, or DOM imports and uses injected `fetch`.
- Lambda handlers depend on `core` at build time and never import `client`.
- Bundle the same `core` sources into the Lambdas that are published to tenants so the
  contract and redaction cannot drift.
- Never log raw report payloads, app data, logs, stack traces, contact details, screenshots,
  or GitHub/AWS credentials. Structured logs carry only metadata (`reportId`, `app`,
  `status`).
- Keep AWS account IDs, secrets, and credentials out of the repository.

## Commit messages

- Keep concise and descriptive.
- Reference plan phases/items when relevant.
- Do not commit secrets or keys.

## Plan tracking

- Update `plan.md` in your feature branch as you work. Mark items `[x]` when complete and
  `[ ]` when pending/in progress.
- Keep the plan in sync with decisions made during implementation.
- **Every implementation commit on a phase branch MUST update `plan.md` to reflect
  completed action items for that phase.**
- When opening/updating a PR for a phase, mark that phase **Completed** in `plan.md`
  (e.g., `### Phase 5: Ingest — Completed`) and check off all completed items.
