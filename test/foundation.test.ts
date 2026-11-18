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
    ['core', '@steventclarke/issue-reporter-core'],
    ['client', '@steventclarke/issue-reporter-client'],
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
    expect(manifest.publishConfig?.registry).toBe('https://npm.pkg.github.com');
  });

  it('keeps root, core, and client versions coupled', () => {
    const rootManifest = readManifest('package.json');
    const core = readManifest('packages/core/package.json');
    const client = readManifest('packages/client/package.json');

    expect(rootManifest.version).toBe(core.version);
    expect(rootManifest.version).toBe(client.version);
    expect(client.dependencies?.['@steventclarke/issue-reporter-core']).toBe(core.version);
    expect(rootManifest.scripts?.['version:check']).toBe('node scripts/check-release.mjs');
    expect(rootManifest.scripts?.['release:check']).toContain('npm publish --workspaces --dry-run');
  });

  it('configures npm for the owner-scoped GitHub Packages registry', () => {
    const npmrc = readFileSync(join(root, '.npmrc'), 'utf8');
    expect(npmrc).toContain('@steventclarke:registry=https://npm.pkg.github.com');
  });

  it('defines a release workflow with a dry-run path', () => {
    const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain("tags:\n      - 'v*'");
    expect(workflow).toContain('dry_run');
    expect(workflow).toContain('npm publish --workspaces --dry-run');
    expect(workflow).toContain('npm publish --workspaces');
    expect(workflow).toContain('packages: write');
  });
});
