import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Manifest = {
  name?: string;
  workspaces?: string[];
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
    ['core', '@issue-reporter/core'],
    ['client', '@issue-reporter/client'],
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
});
