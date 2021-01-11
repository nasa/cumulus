const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { removeNilProperties } = require('@cumulus/common/util');
const { translateApiExecutionToPostgresExecution } = require('../dist/translate/executions');

test('translateApiExecutionToPostgresExecution converts API execution to Postgres', async (t) => {
  const now = Date.now();

  const apiExecution = {
    arn: 'arn:aws:lambda:us-east-1:1234:1234',
    name: `${cryptoRandomString({ length: 10 })}execution`,
    execution: 'https://test',
    error: { test: 'error' },
    tasks: {},
    type: 'IngestGranule',
    status: 'running',
    createdAt: now,
    updatedAt: now,
    timestamp: now,
    originalPayload: { testInput: 'originalPayloadValue' },
    finalPayload: { testOutput: 'finalPayloadValue' },
    duration: 2,
    cumulusVersion: '1.0.0',
  };

  // Note that we are not testing the foreign keys here. Properties like parent_cumulus_id,
  // collection_cumulus_id, and async_operation_cumulus_id are set in
  // translateApiExecutionToPostgresExecution using helpers that are tested elsewhere.
  // The complete execution, including those foreign keys is
  // tested in the data-migration2 integration tests.
  const expectedPostgresExecution = {
    status: apiExecution.status,
    tasks: JSON.stringify(apiExecution.tasks),
    error: JSON.stringify(apiExecution.error),
    arn: apiExecution.arn,
    duration: apiExecution.duration,
    original_payload: JSON.stringify(apiExecution.originalPayload),
    final_payload: JSON.stringify(apiExecution.finalPayload),
    workflow_name: apiExecution.type,
    timestamp: new Date(apiExecution.timestamp),
    created_at: new Date(apiExecution.createdAt),
    updated_at: new Date(apiExecution.updatedAt),
    url: apiExecution.execution,
    cumulus_version: apiExecution.cumulusVersion,
  };

  const result = removeNilProperties(
    await translateApiExecutionToPostgresExecution(apiExecution)
  );

  t.deepEqual(
    result,
    expectedPostgresExecution
  );
});
