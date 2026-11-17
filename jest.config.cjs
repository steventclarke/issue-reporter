/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@issue-reporter/core$': '<rootDir>/packages/core/src/index.ts',
    '^@issue-reporter/client$': '<rootDir>/packages/client/src/index.ts',
  },
  collectCoverageFrom: ['packages/*/src/**/*.ts'],
};
