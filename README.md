# Issue Reporter

Platform-global in-app issue intake backend for `stevenclarke.dev`. It owns the
`issues.stevenclarke.dev` CloudFront endpoint, the ingest and worker Lambdas, report state
in DynamoDB/S3, the SQS worker queue and DLQ, the GitHub App secret, and CloudWatch alarms.
It also publishes the reusable client libraries consumed by tenant applications.

- Design: [`docs/issue-reporting-design.md`](docs/issue-reporting-design.md)
- Diagrams: [`docs/issue-reporting-architecture.md`](docs/issue-reporting-architecture.md)
- Implementation plan and phase checkboxes: [`plan.md`](plan.md)
- Developer conventions: [`AGENTS.md`](AGENTS.md)

## Packages

| Package                               | Purpose                                                        |
| ------------------------------------- | -------------------------------------------------------------- |
| `@stevenclarke/issue-reporter-core`   | Zod request/response contract, shared limits, secret redaction |
| `@stevenclarke/issue-reporter-client` | Framework-agnostic transport, install ID, typed errors         |

`client` depends on `core`; the Lambda handlers depend on `core` at build time and never
import `client`. Both packages publish CommonJS and ESM builds with TypeScript declarations.

`core` is app-agnostic: slugs, environments, categories, reporter providers, app data, and
diagnostics are supplied by tenants; no tenant-specific schema is encoded in it.

## Development

Requires Node 22 or newer and npm.

```bash
npm install
npm run build          # build both packages
npm test               # unit, contract, and CDK assertion tests
npm run format:check
npm run lint
npm run typecheck
npm run version:check
```

Use `npm run format` to apply Prettier. CI runs the same checks on pushes to `main`/
`preview` and on all pull requests. Infrastructure work uses the AWS CDK workflow in
`AGENTS.md` and always defaults to the `preview` context from a workstation.

## Consuming the packages from a tenant app

Packages publish to the platform's AWS CodeArtifact `shared` npm repository. The scope is
`@stevenclarke`, matching the platform artifact contract; no account ID or registry URL is
committed here. Log in with the platform SSO profile, then install a pinned version:

```bash
export AWS_PROFILE=admin
aws sso login --profile admin

DOMAIN=$(aws ssm get-parameter --name /platform/artifacts/codeartifact/domain --region us-east-2 --query Parameter.Value --output text)
OWNER=$(aws ssm get-parameter --name /platform/artifacts/codeartifact/domain-owner --region us-east-2 --query Parameter.Value --output text)
REGION=$(aws ssm get-parameter --name /platform/artifacts/codeartifact/region --region us-east-2 --query Parameter.Value --output text)
REPOSITORY=$(aws ssm get-parameter --name /platform/artifacts/codeartifact/repository --region us-east-2 --query Parameter.Value --output text)
SCOPE=$(aws ssm get-parameter --name /platform/artifacts/codeartifact/npm-scope --region us-east-2 --query Parameter.Value --output text)

aws codeartifact login --tool npm --domain "$DOMAIN" --domain-owner "$OWNER" \
  --region "$REGION" --repository "$REPOSITORY" --namespace "$SCOPE"

npm install --save-exact @stevenclarke/issue-reporter-client@1.0.0
```

Tenant deploy roles have read access by default. The client depends on the exact matching core
version so the published contract and redaction logic cannot drift.

By default the client checks `GET /v1/version` once per reporter instance and refuses to submit
when the deployed API major differs from its own major. Set `skipApiVersionCheck: true` in the
reporter config to opt out. Tenant-side report UI and capture code live in the tenant
repositories, not here.

## Versioning and releases

`package.json`, `packages/core/package.json`, and `packages/client/package.json` always share
one `MAJOR.MINOR.PATCH` version, and that major is the API major used by `/v{major}/reports`.
Use `npm run version:bump -- <major.minor.patch>` to update all three manifests, the
client-to-core dependency, and the lockfile together. The major must equal `API_MAJOR` in
`packages/core/src/limits.ts`.

`npm run version:check` verifies those invariants in CI. After a CodeArtifact login,
`npm run release:check` additionally builds and runs `npm publish --workspaces --dry-run`.

The `Release` workflow assumes the OIDC role in the repository variable `RELEASE_ROLE_ARN`.
That role must be trusted for `steventclarke/issue-reporter` and have CodeArtifact publish
access for `@stevenclarke/*`. The workflow reads the domain, owner, region, repository, and
scope from `/platform/artifacts/codeartifact/*` SSM parameters and generates a short-lived
token for each run.

To release:

1. Open a PR that bumps the coupled version and merge it to `main`.
2. For a rehearsal, run the `Release` workflow manually with `dry_run: true`.
3. For a real release, push a `vX.Y.Z` tag; the workflow verifies the tag, runs checks, and
   publishes both packages to CodeArtifact in core-then-client order.
