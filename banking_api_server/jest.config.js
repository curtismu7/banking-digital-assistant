module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'middleware/**/*.js',
    'routes/**/*.js',
    'services/**/*.js',
    '!**/node_modules/**'
  ],
  testMatch: [
    '**/src/__tests__/**/*.test.js'
  ],
  verbose: true,
  silent: true // Suppress console output during tests
};