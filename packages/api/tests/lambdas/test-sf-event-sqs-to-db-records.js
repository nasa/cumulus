'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const uuidv4 = require('uuid/v4');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const {
  localStackConnectionEnv,
  getKnexClient,
  getDbClient,
  tableNames,
  doesExecutionExist,
} = require('@cumulus/db');
const { constructCollectionId } = require('@cumulus/message/Collections');
const proxyquire = require('proxyquire');
const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');
const {
  isPostRDSDeploymentExecution,
  shouldWriteExecutionToRDS,
  saveExecution,
  saveGranulesToDb,
  savePdrToDb,
} = require('../../lambdas/sf-event-sqs-to-db-records');
const { handler } = proxyquire('../../lambdas/sf-event-sqs-to-db-records', {
  '@cumulus/aws-client/SQS': {
    sendSQSMessage: async (queue, message) => [queue, message],
  },
});

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../lib/testUtils');

const loadFixture = (filename) =>
  fs.readJson(
    path.join(
      __dirname,
      'fixtures',
      'sf-event-sqs-to-db-records',
      filename
    )
  );

const runHandler = async (cumulusMessage = {}) => {
  const fixture = await loadFixture('execution-running-event.json');

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:${fixture.region}:${fixture.account}:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = `arn:aws:states:${fixture.region}:${fixture.account}:execution:${stateMachineName}:${executionName}`;

  fixture.resources = [executionArn];
  fixture.detail.executionArn = executionArn;
  fixture.detail.stateMachineArn = stateMachineArn;
  fixture.detail.name = executionName;

  const granuleId = randomString();
  const files = [fakeFileFactory()];
  const granule = fakeGranuleFactoryV2({ files, granuleId });

  cumulusMessage.payload.granules = [granule];

  const pdrName = randomString();
  cumulusMessage.payload.pdr = {
    name: pdrName,
  };

  fixture.detail.input = JSON.stringify(cumulusMessage);

  const sqsEvent = {
    Records: [{
      eventSource: 'aws:sqs',
      body: JSON.stringify(fixture),
    }],
    env: localStackConnectionEnv,
  };
  const handlerResponse = await handler(sqsEvent);
  return { executionArn, granuleId, pdrName, handlerResponse, sqsEvent };
};

const generateRDSCollectionRecord = (params) => ({
  name: `${cryptoRandomString({ length: 10 })}collection`,
  version: '0.0.0',
  duplicateHandling: 'replace',
  granuleIdValidationRegex: '^MOD09GQ\\.A[\\d]{7}\.[\\S]{6}\\.006\\.[\\d]{13}$',
  granuleIdExtractionRegex: '(MOD09GQ\\.(.*))\\.hdf',
  sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
  files: JSON.stringify([{ regex: '^.*\\.txt$', sampleFileName: 'file.txt', bucket: 'bucket' }]),
  created_at: new Date(),
  updated_at: new Date(),
  ...params,
});

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  process.env.GranulesTable = randomString();
  process.env.PdrsTable = randomString();

  const executionModel = new Execution();
  await executionModel.createTable();
  t.context.executionModel = executionModel;

  const granuleModel = new Granule();
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

  const pdrModel = new Pdr();
  await pdrModel.createTable();
  t.context.pdrModel = pdrModel;

  t.context.describeExecutionStub = sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.resolve({}));
});

test.beforeEach(async (t) => {
  process.env.RDS_DEPLOYMENT_CUMULUS_VERSION = '3.0.0';

  t.context.collection = generateRDSCollectionRecord();
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );

  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      cumulus_version: '4.0.0',
    },
    meta: {
      status: 'running',
      collection: {
        name: t.context.collection.name,
        version: t.context.collection.version,
      },
      provider: {
        id: 'test-provider',
        host: 'test-bucket',
        protocol: 's3',
      },
    },
    payload: {
      key: 'my-payload',
    },
  };

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
    },
  });

  await t.context.knex(tableNames.collections)
    .insert(t.context.collection);

  t.context.executionDbClient = getDbClient(t.context.knex, tableNames.executions);
});

test.after.always(async (t) => {
  const { executionModel } = t.context;
  await executionModel.deleteTable();
});

test('isPostRDSDeploymentExecution correctly returns true if Cumulus version is >= RDS deployment version', (t) => {
  t.true(isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: '3.0.0',
    },
  }));
});

test('isPostRDSDeploymentExecution correctly returns false if Cumulus version is < RDS deployment version', (t) => {
  t.false(isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: '2.0.0',
    },
  }));
});

test('isPostRDSDeploymentExecution correctly returns false if Cumulus version is missing', (t) => {
  t.false(isPostRDSDeploymentExecution({}));
});

test.serial('isPostRDSDeploymentExecution throws error if RDS_DEPLOYMENT_CUMULUS_VERSION env var is missing', (t) => {
  delete process.env.RDS_DEPLOYMENT_CUMULUS_VERSION;
  t.throws(() => isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: '2.0.0',
    },
  }));
});

test('shouldWriteExecutionToRDS returns true for post-RDS deployment execution message with no parent execution', async (t) => {
  const { knex } = t.context;
  t.true(await shouldWriteExecutionToRDS({
    cumulus_meta: {
      cumulus_version: '3.0.0',
    },
  }, knex));
});

test('shouldWriteExecutionToRDS returns false for pre-RDS deployment execution message', async (t) => {
  const { knex } = t.context;
  t.false(await shouldWriteExecutionToRDS({
    cumulus_meta: {
      cumulus_version: '2.99.1',
    },
  }, knex));
});

test('shouldWriteExecutionToRDS returns true for post-RDS deployment execution message with parent execution in RDS', async (t) => {
  const { knex, executionDbClient } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;
  await executionDbClient.insert({
    arn: parentExecutionArn,
  });

  t.true(
    await shouldWriteExecutionToRDS({
      cumulus_meta: {
        cumulus_version: '3.0.0',
        parentExecutionArn,
      },
    }, knex)
  );
});

test('shouldWriteExecutionToRDS returns false if parent execution does not exist in RDS', async (t) => {
  const { knex } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;

  t.false(
    await shouldWriteExecutionToRDS({
      cumulus_meta: {
        cumulus_version: '3.0.0',
        parentExecutionArn,
      },
    }, knex)
  );
});

test('shouldWriteExecutionToRDS returns false if parent execution exists in RDS but not async operation', async (t) => {
  const { knex, executionDbClient } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;
  await executionDbClient.insert({
    arn: parentExecutionArn,
  });

  t.false(
    await shouldWriteExecutionToRDS({
      cumulus_meta: {
        cumulus_version: '3.0.0',
        parentExecutionArn,
        asyncOperationId: uuidv4(),
      },
    }, knex)
  );
});

test('shouldWriteExecutionToRDS returns false if parent execution and async operation exist in RDS but not collection', async (t) => {
  const { knex, executionDbClient } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;
  await executionDbClient.insert({
    arn: parentExecutionArn,
  });

  const asyncOperationId = uuidv4();
  await getDbClient(knex, tableNames.asyncOperations)
    .insert({
      id: asyncOperationId,
      description: 'test-async-operation',
      operationType: 'Bulk Granules',
      status: 'RUNNING',
    });

  t.false(
    await shouldWriteExecutionToRDS({
      cumulus_meta: {
        cumulus_version: '3.0.0',
        parentExecutionArn,
        asyncOperationId,
      },
      meta: {
        collection: {
          name: 'fake-name',
          version: '0.0.0',
        },
      },
    }, knex)
  );
});

test('saveExecution() saves execution to Dynamo and RDS if write to RDS is enabled', async (t) => {
  const { cumulusMessage, executionModel, knex } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;

  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  await saveExecution(cumulusMessage, knex);
  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(
    await doesExecutionExist({
      arn: executionArn,
    }, knex)
  );
});

test.serial('saveExecution() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
  const { cumulusMessage, executionModel, knex } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;

  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const saveExecutionStub = sinon.stub(Execution.prototype, 'storeExecutionFromCumulusMessage')
    .callsFake(() => {
      throw new Error('fake error');
    });
  const trxSpy = sinon.spy(knex, 'transaction');
  t.teardown(() => {
    saveExecutionStub.restore();
    trxSpy.restore();
  });

  await t.throwsAsync(saveExecution(cumulusMessage, knex));
  t.true(trxSpy.called);
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(
    await doesExecutionExist({
      arn: executionArn,
    }, knex)
  );
});

test.serial('saveExecution() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
  const { cumulusMessage, executionModel, knex } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;

  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('fake insert error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  await t.throwsAsync(saveExecution(cumulusMessage, knex));
  t.true(trxStub.called);
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(
    await doesExecutionExist({
      arn: executionArn,
    }, knex)
  );
});

test('saveGranulesToDb() saves a granule record to the database', async (t) => {
  const { cumulusMessage, granuleModel, collectionId } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const granuleId = randomString();
  const files = [fakeFileFactory({ size: 250 })];
  const granule = fakeGranuleFactoryV2({
    files,
    granuleId,
  });
  delete granule.version;
  delete granule.dataType;
  cumulusMessage.payload.granules = [granule];

  await saveGranulesToDb(cumulusMessage);

  const fetchedGranule = await granuleModel.get({ granuleId });
  const expectedGranule = {
    ...granule,
    collectionId,
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
    productVolume: 250,
    provider: 'test-provider',
    status: 'running',
    createdAt: 122,
    error: {},
    timeToArchive: 0,
    timeToPreprocess: 0,
    duration: fetchedGranule.duration,
    timestamp: fetchedGranule.timestamp,
    updatedAt: fetchedGranule.updatedAt,
  };
  t.deepEqual(fetchedGranule, expectedGranule);
});

test.serial('saveGranulesToDb() throws an exception if storeGranulesFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage } = t.context;

  const storeGranuleStub = sinon.stub(Granule.prototype, 'storeGranulesFromCumulusMessage')
    .callsFake(() => {
      throw new Error('error');
    });

  try {
    await t.throwsAsync(saveGranulesToDb(cumulusMessage));
  } finally {
    storeGranuleStub.restore();
  }
});

test.serial('savePdrToDb() saves a PDR record', async (t) => {
  const { cumulusMessage, pdrModel } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = 'https://console.aws.amazon.com/states/home?region=us-east-1#/executions/'
    + `details/arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const pdr = {
    name: randomString(),
    PANSent: false,
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
    completed: new Array(4).map(randomString),
    failed: new Array(2).map(randomString),
    running: new Array(6).map(randomString),
  };
  await savePdrToDb(cumulusMessage);

  const collectionId = (() => {
    const { name, version } = cumulusMessage.meta.collection;
    return constructCollectionId(name, version);
  })();

  const fetchedPdr = await pdrModel.get({ pdrName: pdr.name });
  const expectedPdr = {
    pdrName: pdr.name,
    collectionId,
    status: cumulusMessage.meta.status,
    provider: cumulusMessage.meta.provider.id,
    progress: 50,
    execution: executionArn,
    PANSent: false,
    PANmessage: 'test',
    stats: {
      processing: 6,
      completed: 4,
      failed: 2,
      total: 12,
    },
    createdAt: cumulusMessage.cumulus_meta.workflow_start_time,
    duration: fetchedPdr.duration,
    timestamp: fetchedPdr.timestamp,
  };
  t.deepEqual(fetchedPdr, expectedPdr);
});

test.serial('savePdrToDb() throws an exception if storePdrFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage } = t.context;

  const storeGranuleStub = sinon.stub(Pdr.prototype, 'storePdrFromCumulusMessage')
    .callsFake(() => {
      throw new Error('error');
    });
  try {
    await t.throwsAsync(savePdrToDb(cumulusMessage));
  } finally {
    storeGranuleStub.restore();
  }
});

test('sf-event-sqs-to-db-records handler sends message to DLQ when granule and pdr fail to write to database', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
  } = t.context;

  delete cumulusMessage.meta.collection;
  const {
    executionArn,
    granuleId,
    pdrName,
    handlerResponse,
    sqsEvent,
  } = await runHandler(cumulusMessage);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(await pdrModel.exists({ pdrName }));
  t.is(handlerResponse[0][1].body, sqsEvent.Records[0].body);
});

test('The sf-event-sqs-to-db-records Lambda adds records to the granule, execution and pdr tables', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
  } = t.context;

  const { executionArn, granuleId, pdrName } = await runHandler(cumulusMessage);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));
});

test('Lambda writes records to Dynamo and not RDS if cumulus version is less than RDS deployment version', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    knex,
  } = t.context;

  cumulusMessage.cumulus_meta.cumulus_version = '2.0.1';

  const { executionArn, granuleId, pdrName } = await runHandler(cumulusMessage);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));

  t.falsy(
    await knex('executions')
      .where('arn', executionArn)
      .first()
  );
  // Add assertions for granule, PDR
});
