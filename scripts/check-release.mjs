import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const expectedVersion = process.argv[2];
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const rootPkg = readJson('package.json');
const corePkg = readJson('packages/core/package.json');
const clientPkg = readJson('packages/client/package.json');
const limits = readFileSync(join(root, 'packages/core/src/limits.ts'), 'utf8');
const apiMajorMatch = limits.match(/export const API_MAJOR = (\d+);/);

const errors = [];
const versions = {
  root: rootPkg.version,
  core: corePkg.version,
  client: clientPkg.version,
};

if (!apiMajorMatch) {
  errors.push('packages/core/src/limits.ts must define API_MAJOR');
}

const apiMajor = apiMajorMatch ? Number(apiMajorMatch[1]) : null;
const expectedMajor = expectedVersion?.match(semverPattern)?.[1];

if (expectedVersion && !semverPattern.test(expectedVersion)) {
  errors.push(`invalid release version: ${expectedVersion}`);
}

for (const [name, version] of Object.entries(versions)) {
  if (!semverPattern.test(version)) errors.push(`${name} has invalid version: ${version}`);
  if (
    apiMajor !== null &&
    semverPattern.test(version) &&
    Number(version.split('.')[0]) !== apiMajor
  ) {
    errors.push(`${name} major must match API_MAJOR ${apiMajor}`);
  }
  if (expectedVersion && version !== expectedVersion) {
    errors.push(`${name} version ${version} does not match ${expectedVersion}`);
  }
}

if (new Set(Object.values(versions)).size !== 1) {
  errors.push('root, core, and client versions must match');
}

if (corePkg.name !== '@steventclarke/issue-reporter-core') {
  errors.push('core package name must be @steventclarke/issue-reporter-core');
}
if (clientPkg.name !== '@steventclarke/issue-reporter-client') {
  errors.push('client package name must be @steventclarke/issue-reporter-client');
}
if (clientPkg.dependencies?.['@steventclarke/issue-reporter-core'] !== versions.core) {
  errors.push('client must depend on the exact matching core version');
}
if (corePkg.publishConfig?.registry !== 'https://npm.pkg.github.com') {
  errors.push('core publishConfig registry must be https://npm.pkg.github.com');
}
if (clientPkg.publishConfig?.registry !== 'https://npm.pkg.github.com') {
  errors.push('client publishConfig registry must be https://npm.pkg.github.com');
}
if (expectedMajor && apiMajor !== null && Number(expectedMajor) !== apiMajor) {
  errors.push(`expected version major ${expectedMajor} does not match API_MAJOR ${apiMajor}`);
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exit(1);
}

process.stdout.write(`release ${versions.core} is consistent with API v${apiMajor}\n`);
