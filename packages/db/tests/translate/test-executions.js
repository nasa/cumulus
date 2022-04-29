const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  translateApiExecutionToPostgresExecution,
  translatePostgresExecutionToApiExecution,
} = require('../../dist/translate/executions');

const {
  fakeExecutionRecordFactory,
} = require('../../dist');

// Response to https://github.com/nasa/cumulus/pull/2263#discussion_r646632487
test('translatePostgresExecutionToApiExecution with no FKs does not call external model ".get" methods', async (t) => {
  const dbCallThrow = () => {
    throw new Error('External Model Should Not Be Called');
  };

  const fakeCollectionPgModel = {
    get: dbCallThrow,
  };
  const fakeAsyncOperationPgModel = {
    get: dbCallThrow,
  };
  const fakeExecutionPgModel = {
    get: dbCallThrow,
  };

  const executionRecord = fakeExecutionRecordFactory();
  await t.notThrowsAsync(translatePostgresExecutionToApiExecution(
    executionRecord,
    {},
    fakeCollectionPgModel,
    fakeAsyncOperationPgModel,
    fakeExecutionPgModel
  ));
});

test('translatePostgresExecutionToApiExecution translates a Postgres execution to an API record', async (t) => {
  const collectionId = constructCollectionId('name', 'version');

  const fakeCollectionPgModel = {
    get: () => Promise.resolve({ name: 'name', version: 'version' }),
  };
  const fakeAsyncOperationPgModel = {
    get: () => Promise.resolve({ id: 'asyncOperationCumulusId' }),
  };
  const fakeExecutionPgModel = {
    get: () => Promise.resolve({ arn: 'executionCumulusId' }),
  };

  const executionRecord = {
    arn: 'arn:aws:lambda:us-east-1:1234:1234',
    async_operation_cumulus_id: 1,
    collection_cumulus_id: 1,
    created_at: new Date(),
    cumulus_id: 2,
    cumulus_version: '1.0.0',
    duration: 2,
    error: { test: 'error' },
    execution: 'https://test',
    final_payload: { testOutput: 'finalPayloadValue' },
    original_payload: { testInput: 'originalPayloadValue' },
    parent_cumulus_id: 1,
    status: 'running',
    tasks: {},
    timestamp: new Date(),
    type: 'IngestGranule',
    updated_at: new Date(),
    url: 'https://test',
    workflow_name: 'TestWorkflow',
  };

  const expectedApiExecution = {
    arn: executionRecord.arn,
    asyncOperationId: 'asyncOperationCumulusId',
    collectionId,
    createdAt: executionRecord.created_at.getTime(),
    cumulusVersion: executionRecord.cumulus_version,
    duration: executionRecord.duration,
    error: executionRecord.error,
    execution: executionRecord.url,
    finalPayload: executionRecord.final_payload,
    name: executionRecord.arn.split(':').pop(),
    originalPayload: executionRecord.original_payload,
    parentArn: 'executionCumulusId',
    status: executionRecord.status,
    tasks: executionRecord.tasks,
    timestamp: executionRecord.timestamp.getTime(),
    type: executionRecord.workflow_name,
    updatedAt: executionRecord.updated_at.getTime(),
  };

  const result = await translatePostgresExecutionToApiExecution(
    executionRecord,
    {},
    fakeCollectionPgModel,
    fakeAsyncOperationPgModel,
    fakeExecutionPgModel
  );

  t.deepEqual(
    result,
    expectedApiExecution
  );
});

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
    collectionId: constructCollectionId('name', 'version'),
    asyncOperationId: '1234',
    parentArn: 'arn:aws:lambda:us-east-1:5678:5678',
  };

  const collectionCumulusId = 1;
  const asyncOperationCumulusId = 2;
  const executionCumulusId = 3;

  const fakeDbClient = {};

  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeAsyncOperationPgModel = {
    getRecordCumulusId: () => Promise.resolve(asyncOperationCumulusId),
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: () => Promise.resolve(executionCumulusId),
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
