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

| Package                  | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `@issue-reporter/core`   | Zod request/response contract, shared limits, secret redaction |
| `@issue-reporter/client` | Framework-agnostic transport, install ID, typed errors         |

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
```

Use `npm run format` to apply Prettier. CI runs the same checks on pushes to `main`/
`preview` and on all pull requests. Infrastructure work uses the AWS CDK workflow in
`AGENTS.md` and always defaults to the `preview` context from a workstation.

## Consuming the packages from a tenant app

Packages publish to the private GitHub Packages registry first. A tenant repo needs a
`.npmrc` (not committed with a real token) and a token with `read:packages`:

```ini
@issue-reporter:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

In CI, set `GITHUB_TOKEN` as a secret. Then install normally:

```bash
npm install @issue-reporter/client
```

Keep names and versions unchanged if publishing switches to public npm later. Tenant-side
report UI and capture code live in the tenant repositories, not here.
