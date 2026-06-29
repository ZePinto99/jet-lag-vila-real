const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

/** @type {import('jest').Config} */
const config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.test.tsx',
  ],
  testEnvironment: 'jsdom',
  watchman: false,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'components/**/*.tsx',
    '!lib/supabase/**',
    '!lib/types.ts',
  ],
}

module.exports = createJestConfig(config)
