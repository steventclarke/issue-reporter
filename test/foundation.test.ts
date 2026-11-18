import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Manifest = {
  name?: string;
  version?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, unknown>;
  main?: string;
  types?: string;
  files?: string[];
  publishConfig?: { registry?: string };
};

const root = join(__dirname, '..');
const readManifest = (path: string): Manifest =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as Manifest;

describe('workspace foundation', () => {
  it('declares both publishable packages as workspaces', () => {
    expect(readManifest('package.json').workspaces).toEqual(['packages/core', 'packages/client']);
  });

  it.each([
    ['core', '@stevenclarke/issue-reporter-core'],
    ['client', '@stevenclarke/issue-reporter-client'],
  ])('configures %s for dual-format publishing', (directory, name) => {
    const manifest = readManifest(`packages/${directory}/package.json`);

    expect(manifest.name).toBe(name);
    expect(manifest.main).toMatch(/dist\/index\.js$/);
    expect(manifest.types).toMatch(/dist\/index\.d\.ts$/);
    expect(manifest.exports?.['.']).toMatchObject({
      import: expect.stringMatching(/dist\/index\.mjs$/),
      require: expect.stringMatching(/dist\/index\.js$/),
    });
    expect(manifest.files).toContain('dist');
    expect(manifest.publishConfig?.registry).toBeUndefined();
  });

  it('keeps root, core, and client versions coupled', () => {
    const rootManifest = readManifest('package.json');
    const core = readManifest('packages/core/package.json');
    const client = readManifest('packages/client/package.json');

    expect(rootManifest.version).toBe(core.version);
    expect(rootManifest.version).toBe(client.version);
    expect(client.dependencies?.['@stevenclarke/issue-reporter-core']).toBe(core.version);
    expect(rootManifest.scripts?.['version:check']).toBe('node scripts/check-release.mjs');
    expect(rootManifest.scripts?.['release:check']).toContain('npm publish --workspaces --dry-run');
  });

  it('documents CodeArtifact login instead of committing registry credentials', () => {
    const example = readFileSync(join(root, '.npmrc.example'), 'utf8');
    expect(example).toContain('aws codeartifact login');
    expect(example).toContain('@stevenclarke:registry=${CODEARTIFACT_NPM_REGISTRY_URL}');
    expect(example).not.toContain('npm.pkg.github.com');
  });

  it('defines a CodeArtifact release workflow with a dry-run path', () => {
    const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain("tags:\n      - 'v*'");
    expect(workflow).toContain('dry_run');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('aws-actions/configure-aws-credentials@v4');
    expect(workflow).toContain('/platform/artifacts/codeartifact/domain');
    expect(workflow).toContain('aws codeartifact get-authorization-token');
    expect(workflow).toContain('npm config set "${SCOPE}:registry" "https://${ENDPOINT}"');
    expect(workflow).toContain('npm publish --workspaces --dry-run');
    expect(workflow).toContain('npm publish --workspaces');
    expect(workflow).not.toContain('npm.pkg.github.com');
    expect(workflow).not.toContain('packages: write');
    expect(workflow).not.toContain('NODE_AUTH_TOKEN');
  });
});
