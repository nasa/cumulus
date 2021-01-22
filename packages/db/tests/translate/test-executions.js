const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { removeNilProperties } = require('@cumulus/common/util');
const { translateApiExecutionToPostgresExecution } = require('../../dist/translate/executions');

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
    collectionId: 'name___version',
    asyncOperationId: '1234',
    parentArn: 'arn:aws:lambda:us-east-1:5678:5678',
  };

  const collectionCumulusId = 1;
  const asyncOperationCumulusId = 2;
  const executionCumulusId = 3;

  const fakeDbClient = {};

  const fakeCollectionPgModel = {
    getRecordCumulusId: async () => collectionCumulusId,
  };
  const fakeAsyncOperationPgModel = {
    getRecordCumulusId: async () => asyncOperationCumulusId,
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: async () => executionCumulusId,
  };

  const expectedPostgresExecution = {
    status: apiExecution.status,
    tasks: apiExecution.tasks,
    error: apiExecution.error,
    arn: apiExecution.arn,
    duration: apiExecution.duration,
    original_payload: apiExecution.originalPayload,
    final_payload: apiExecution.finalPayload,
    workflow_name: apiExecution.type,
    timestamp: new Date(apiExecution.timestamp),
    created_at: new Date(apiExecution.createdAt),
    updated_at: new Date(apiExecution.updatedAt),
    url: apiExecution.execution,
    cumulus_version: apiExecution.cumulusVersion,
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: executionCumulusId,
  };

  const result = removeNilProperties(
    await translateApiExecutionToPostgresExecution(
      apiExecution,
      fakeDbClient,
      fakeCollectionPgModel,
      fakeAsyncOperationPgModel,
      fakeExecutionPgModel
    )
  );

  t.deepEqual(
    result,
    expectedPostgresExecution
  );
});
