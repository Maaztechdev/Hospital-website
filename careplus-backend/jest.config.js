/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    "^@modules/(.*)$": "<rootDir>/src/modules/$1",
    "^@common/(.*)$": "<rootDir>/src/common/$1",
    "^@config/(.*)$": "<rootDir>/src/config/$1",
  },
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  globalTeardown: "<rootDir>/tests/globalTeardown.ts",
  testTimeout: 60000,
};
