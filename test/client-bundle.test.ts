import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const srcDir = join(process.cwd(), 'packages/client/src');
const sourceFiles = readdirSync(srcDir).filter((name) => name.endsWith('.ts'));
const sources = sourceFiles.map((name) => readFileSync(join(srcDir, name), 'utf8')).join('\n');

describe('client bundle boundaries', () => {
  it('has no React, React Native, Expo, Node, AWS, or DOM imports', () => {
    const forbidden = [
      /from\s+['"](?:react|react-native|expo|@react-native\/[^'"]+|@aws-sdk\/[^'"]+|node:[^'"]+)['"]/i,
      /\bAsyncStorage\b/,
      /\bdocument\./,
      /\bwindow\./,
      /\blocalStorage\b/,
      /\bnavigator\./,
    ];

    for (const pattern of forbidden) {
      expect(sources).not.toMatch(pattern);
    }
  });

  it('publishes CommonJS, ESM, and declaration entry points', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/client/package.json'), 'utf8'),
    ) as { exports: Record<string, Record<string, string>> };

    expect(pkg.exports['.']).toMatchObject({
      types: './dist/index.d.ts',
      import: './dist/index.mjs',
      require: './dist/index.js',
    });
  });
});
