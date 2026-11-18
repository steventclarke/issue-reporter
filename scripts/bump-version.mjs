import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const version = process.argv[2];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!version || !semverPattern.test(version)) {
  process.stderr.write('usage: npm run version:bump -- <major.minor.patch>\n');
  process.exit(1);
}

const limits = readFileSync(join(root, 'packages/core/src/limits.ts'), 'utf8');
const apiMajorMatch = limits.match(/export const API_MAJOR = (\d+);/);
if (!apiMajorMatch) {
  process.stderr.write('packages/core/src/limits.ts must define API_MAJOR\n');
  process.exit(1);
}

const apiMajor = Number(apiMajorMatch[1]);
if (Number(version.split('.')[0]) !== apiMajor) {
  process.stderr.write(`version major must match API_MAJOR ${apiMajor}\n`);
  process.exit(1);
}

const manifests = ['package.json', 'packages/core/package.json', 'packages/client/package.json'];

for (const path of manifests) {
  const fullPath = join(root, path);
  const manifest = JSON.parse(readFileSync(fullPath, 'utf8'));
  manifest.version = version;
  if (path === 'packages/client/package.json') {
    manifest.dependencies['@stevenclarke/issue-reporter-core'] = version;
  }
  writeFileSync(fullPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

execFileSync('npm', ['install', '--package-lock-only'], { cwd: root, stdio: 'inherit' });
process.stdout.write(`bumped coupled version to ${version}\n`);
