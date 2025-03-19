# Humanify Test Suite

This directory contains all test-related files and utilities for the Humanify project. The test suite is organized into several subdirectories for different testing purposes.

## Directory Structure

- `fixtures/`: Test data files used by various tests
- `integration/`: End-to-end integration tests
- `mock/`: Mock implementations for testing without external dependencies
- `output/`: Generated output from test runs
- `scripts/`: Utility scripts for test setup and execution
- `temp/`: Temporary files created during test execution

## Test Scripts

### Creating Test Files

You can create test files using either of these scripts:

```bash
# Using Python
python test/scripts/create_test_file.py

# Using Shell
./test/scripts/create-test-file.sh
```

### Running Tests with OpenAI API

To run tests using your OpenAI API key from `.env` file:

```bash
# Run standard OpenAI test
npx tsx test/scripts/run_openai_test.js

# Run batch processing test with OpenAI API
npx tsx test/scripts/run_batch_test.js
```

### Running Mock Tests

To run tests with the mock OpenAI API server (without incurring API costs):

```bash
# Run with mock server
npx tsx test/scripts/run_mock_test.mjs
```

### Cleaning Test Environment

To clean up test outputs and reset the environment:

```bash
npx tsx test/scripts/clean_test.js
```

## Integration Tests

The `integration/` directory contains end-to-end tests for various providers:

- `e2e.openaitest.ts`: Tests using the OpenAI provider
- `e2e.geminitest.ts`: Tests using the Gemini provider
- `local.e2etest.ts`: Tests using a local provider
- `test-batch-processing.ts`: Tests for the batch processing feature

## Running Tests

Integration tests can be run using the npm test command with the appropriate test file:

```bash
npm test -- test/integration/test-batch-processing.ts
```

## Best Practices

1. Always add new test files to the appropriate subdirectory
2. Use the fixtures directory for all test data
3. Clean up temporary files after test runs when possible
4. Document any new test utilities or scripts in this README
5. For tests that require API keys, make sure they are in the `.env` file
6. Prefer mock tests for CI/CD pipelines to avoid API costs 