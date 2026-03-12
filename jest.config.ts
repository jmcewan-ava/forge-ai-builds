import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        esModuleInterop: true,
        strict: true
      }
    }]
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1'
  },
  // Don't test files that need DB/Supabase/Claude — only pure functions
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'lib/orchestrator.ts',
    'lib/context-packet.ts',
    'lib/file-lock.ts',
    'lib/cost-controller.ts'
  ],
  coverageReporters: ['text', 'lcov'],
  verbose: true
}

export default config
