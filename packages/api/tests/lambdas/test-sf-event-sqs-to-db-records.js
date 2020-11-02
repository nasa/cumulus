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
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');
const { constructCollectionId } = require('@cumulus/message/Collections');
const proxyquire = require('proxyquire');

const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');

const sandbox = sinon.createSandbox();
const stubRecordExists = sandbox.stub().resolves(true);

const {
  handler,
  isPostRDSDeploymentExecution,
  hasNoParentExecutionOrExists,
  hasNoAsyncOpOrExists,
  getMessageCollection,
  getMessageProvider,
  shouldWriteExecutionToRDS,
  saveExecution,
  saveGranulesToDb,
  savePdr,
  saveRecords,
} = proxyquire('../../lambdas/sf-event-sqs-to-db-records', {
  '@cumulus/aws-client/SQS': {
    sendSQSMessage: async (queue, message) => [queue, message],
  },
  '@cumulus/db': {
    doesRecordExist: stubRecordExists,
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

  fixture.detail.input = JSON.stringify(cumulusMessage);

  const sqsEvent = {
    Records: [{
      eventSource: 'aws:sqs',
      body: JSON.stringify(fixture),
    }],
    env: localStackConnectionEnv,
  };
  const handlerResponse = await handler(sqsEvent);
  return { executionArn, handlerResponse, sqsEvent };
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
  t.context.postRDSDeploymentVersion = '4.0.0';
  t.context.preRDSDeploymentVersion = '2.9.99';

  t.context.collection = generateRDSCollectionRecord();
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );

  const stateMachineName = cryptoRandomString({ length: 5 });
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;

  const executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  t.context.parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;
  t.context.asyncOperationId = uuidv4();

  t.context.provider = {
    id: `provider${cryptoRandomString({ length: 5 })}`,
    host: 'test-bucket',
    protocol: 's3',
  };

  t.context.pdrName = cryptoRandomString({ length: 10 });
  t.context.pdr = {
    name: t.context.pdrName,
    PANSent: false,
    PANmessage: 'test',
  };

  t.context.granuleId = cryptoRandomString({ length: 10 });
  const files = [fakeFileFactory()];
  const granule = fakeGranuleFactoryV2({ files, granuleId: t.context.granuleId });

  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      cumulus_version: t.context.postRDSDeploymentVersion,
      state_machine: stateMachineArn,
      execution_name: executionName,
      parentExecutionArn: t.context.parentExecutionArn,
      asyncOperationId: t.context.asyncOperationId,
    },
    meta: {
      status: 'running',
      collection: t.context.collection,
      provider: t.context.provider,
    },
    payload: {
      key: 'my-payload',
      pdr: t.context.pdr,
      granules: [granule],
    },
  };

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
    },
  });

  const collectionResponse = await t.context.knex(tableNames.collections)
    .insert(t.context.collection)
    .returning('cumulusId');
  t.context.collectionCumulusId = collectionResponse[0];

  const providerResponse = await t.context.knex(tableNames.providers)
    .insert({
      name: t.context.provider.id,
      host: t.context.provider.host,
      protocol: t.context.provider.protocol,
    })
    .returning('cumulusId');
  t.context.providerCumulusId = providerResponse[0];

  t.context.doesRecordExistStub = stubRecordExists;
  t.context.doesRecordExistStub.resetHistory();
});

test.after.always(async (t) => {
  const { executionModel } = t.context;
  await executionModel.deleteTable();
  sandbox.restore();
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

test('hasNoParentExecutionOrExists returns true if there is no parent execution', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  t.true(await hasNoParentExecutionOrExists({}, knex));
  t.false(doesRecordExistStub.called);
});

test.serial('hasNoParentExecutionOrExists returns true if parent execution exists', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;

  doesRecordExistStub.withArgs({
    arn: parentExecutionArn,
  }).resolves(true);

  t.true(await hasNoParentExecutionOrExists({
    cumulus_meta: {
      parentExecutionArn,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test.serial('hasNoParentExecutionOrExists returns false if parent execution does not exist', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const parentExecutionArn = `machine:${cryptoRandomString({ length: 5 })}`;

  doesRecordExistStub.withArgs({
    arn: parentExecutionArn,
  }).resolves(false);

  t.false(await hasNoParentExecutionOrExists({
    cumulus_meta: {
      parentExecutionArn,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test('hasNoAsyncOpOrExists returns true if there is no async operation', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  t.true(await hasNoAsyncOpOrExists({}, knex));
  t.false(doesRecordExistStub.called);
});

test.serial('hasNoAsyncOpOrExists returns true if async operation exists', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const asyncOperationId = uuidv4();

  doesRecordExistStub.withArgs({
    id: asyncOperationId,
  }).resolves(true);

  t.true(await hasNoAsyncOpOrExists({
    cumulus_meta: {
      asyncOperationId,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test.serial('hasNoAsyncOpOrExists returns false if async operation does not exist', async (t) => {
  const { knex, doesRecordExistStub } = t.context;
  const asyncOperationId = uuidv4();

  doesRecordExistStub.withArgs({
    id: asyncOperationId,
  }).resolves(false);

  t.false(await hasNoAsyncOpOrExists({
    cumulus_meta: {
      asyncOperationId,
    },
  }, knex));
  t.true(doesRecordExistStub.called);
});

test('getMessageCollection returns correct collection', async (t) => {
  const { collection, cumulusMessage } = t.context;

  const fakeKnex = () => ({
    where: (params) => ({
      first: async () => {
        if (params.name === collection.name
            && params.version === collection.version) {
          return {
            cumulusId: 5,
          };
        }
        return undefined;
      },
    }),
  });

  t.deepEqual(
    await getMessageCollection(cumulusMessage, fakeKnex),
    {
      cumulusId: 5,
    }
  );
});

test('getMessageCollection returns undefined if collection cannot be found', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageCollection({}, knex), undefined);
});

test('getMessageProvider returns correct provider', async (t) => {
  const { cumulusMessage, provider } = t.context;

  const fakeKnex = () => ({
    where: (params) => ({
      first: async () => {
        if (params.name === provider.id) {
          return {
            cumulusId: 234,
          };
        }
        return undefined;
      },
    }),
  });

  t.deepEqual(
    await getMessageProvider(cumulusMessage, fakeKnex),
    {
      cumulusId: 234,
    }
  );
});

test('getMessageProvider returns undefined if provider cannot be found', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageProvider({}, knex), undefined);
});

test('shouldWriteExecutionToRDS returns false for pre-RDS deployment execution message', async (t) => {
  const { cumulusMessage, knex, preRDSDeploymentVersion } = t.context;
  t.false(await shouldWriteExecutionToRDS(
    {
      ...cumulusMessage,
      cumulus_meta: {
        ...cumulusMessage.cumulus_meta,
        cumulus_version: preRDSDeploymentVersion,
      },
    },
    { cumulusId: 1 },
    knex
  ));
});

test.serial('shouldWriteExecutionToRDS returns true for post-RDS deployment execution message if all referenced objects exist', async (t) => {
  const {
    knex,
    doesRecordExistStub,
    cumulusMessage,
    asyncOperationId,
    parentExecutionArn,
  } = t.context;

  doesRecordExistStub.withArgs({
    id: asyncOperationId,
  }).resolves(true);
  doesRecordExistStub.withArgs({
    arn: parentExecutionArn,
  }).resolves(true);

  t.true(
    await shouldWriteExecutionToRDS(
      cumulusMessage,
      { cumulusId: 1 },
      knex
    )
  );
});

test.serial('shouldWriteExecutionToRDS returns false if error is thrown', async (t) => {
  const {
    knex,
    doesRecordExistStub,
    cumulusMessage,
    parentExecutionArn,
    collectionCumulusId,
  } = t.context;

  doesRecordExistStub.withArgs({
    arn: parentExecutionArn,
  }).throws();

  t.false(
    await shouldWriteExecutionToRDS(cumulusMessage, { cumulusId: collectionCumulusId }, knex)
  );
});

test('shouldWriteExecutionToRDS returns false if collection record is not defined', async (t) => {
  const {
    knex,
    cumulusMessage,
  } = t.context;

  t.false(
    await shouldWriteExecutionToRDS(cumulusMessage, undefined, knex)
  );
});

test('shouldWriteExecutionToRDS returns false if any referenced objects are missing', async (t) => {
  const {
    knex,
    doesRecordExistStub,
    cumulusMessage,
    asyncOperationId,
    collectionCumulusId,
  } = t.context;

  doesRecordExistStub.withArgs({
    id: asyncOperationId,
  }).resolves(false);

  t.false(
    await shouldWriteExecutionToRDS(cumulusMessage, { cumulusId: collectionCumulusId }, knex)
  );
});

test('saveExecution() saves execution to Dynamo and RDS if write to RDS is enabled', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
  } = t.context;

  await saveExecution({ cumulusMessage, knex });

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
});

test.serial('saveExecution() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
  } = t.context;

  const fakeExecutionModel = {
    storeExecutionFromCumulusMessage: () => {
      throw new Error('execution Dynamo error');
    },
  };

  await t.throwsAsync(
    saveExecution({
      cumulusMessage,
      knex,
      executionModel: fakeExecutionModel,
    }),
    { message: 'execution Dynamo error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
});

test.serial('saveExecution() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
  } = t.context;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('execution RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  await t.throwsAsync(
    saveExecution({ cumulusMessage, knex }),
    { message: 'execution RDS error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
});

test('saveGranulesToDb() saves a granule record to the database', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    collectionId,
    provider,
    executionArn,
  } = t.context;

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
    provider: provider.id,
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

test('savePdr() returns true if there is no PDR on the message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  delete cumulusMessage.payload.pdr;

  t.true(
    await savePdr({
      cumulusMessage,
      collection: { id: collectionCumulusId },
      provider: { id: providerCumulusId },
      knex,
    })
  );
});

test('savePdr() throws an error if collection is not provided', async (t) => {
  const { cumulusMessage, knex, providerCumulusId } = t.context;
  await t.throwsAsync(
    savePdr({
      cumulusMessage,
      collection: undefined,
      provider: { id: providerCumulusId },
      knex,
    })
  );
});

test('savePdr() throws an error if provider is not provided', async (t) => {
  const { cumulusMessage, knex, collectionCumulusId } = t.context;
  await t.throwsAsync(
    savePdr({
      cumulusMessage,
      collection: { id: collectionCumulusId },
      provider: undefined,
      knex,
    })
  );
});

test('savePdr() saves a PDR record to Dynamo and RDS if RDS write is enabled', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    pdr,
  } = t.context;

  await savePdr({
    cumulusMessage,
    collection: { cumulusId: collectionCumulusId },
    provider: { cumulusId: providerCumulusId },
    knex,
  });

  t.true(await pdrModel.exists({ pdrName: pdr.name }));
  t.true(
    await doesRecordExist({
      name: pdr.name,
    }, knex, tableNames.pdrs)
  );
});

test('savePdr() does not persist records Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  const pdr = {
    name: randomString(),
    PANSent: false,
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
  };

  const fakePdrModel = {
    storePdrFromCumulusMessage: () => {
      throw new Error('PDR dynamo error');
    },
  };

  await t.throwsAsync(
    savePdr({
      cumulusMessage,
      collection: { cumulusId: collectionCumulusId },
      provider: { cumulusId: providerCumulusId },
      knex,
      pdrModel: fakePdrModel,
    }),
    { message: 'PDR dynamo error' }
  );

  t.false(await pdrModel.exists({ pdrName: pdr.name }));
  t.false(
    await doesRecordExist({
      name: pdr.name,
    }, knex, tableNames.pdrs)
  );
});

test('savePdr() does not persist records Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  const pdr = {
    name: randomString(),
    PANSent: false,
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
  };

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('PDR RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  await t.throwsAsync(
    savePdr({
      cumulusMessage,
      collection: { cumulusId: collectionCumulusId },
      provider: { cumulusId: providerCumulusId },
      knex,
    }),
    { message: 'PDR RDS error' }
  );

  t.false(await pdrModel.exists({ pdrName: pdr.name }));
  t.false(
    await doesRecordExist({
      name: pdr.name,
    }, knex, tableNames.pdrs)
  );
});

test('Lambda sends message to DLQ when any write to database fails', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    granuleId,
    pdrName,
  } = t.context;

  delete cumulusMessage.meta.collection;
  const {
    executionArn,
    handlerResponse,
    sqsEvent,
  } = await runHandler(cumulusMessage);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(await pdrModel.exists({ pdrName }));
  t.is(handlerResponse[0][1].body, sqsEvent.Records[0].body);
});

test('saveRecords() only writes records to Dynamo if cumulus version is less than RDS deployment version', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    knex,
    preRDSDeploymentVersion,
    executionArn,
    pdrName,
    granuleId,
  } = t.context;

  cumulusMessage.cumulus_meta.cumulus_version = preRDSDeploymentVersion;

  await saveRecords(cumulusMessage, knex);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));

  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
  t.false(
    await doesRecordExist({
      name: pdrName,
    }, knex, tableNames.pdrs)
  );
  t.false(
    await doesRecordExist({
      granuleId,
    }, knex, tableNames.granules)
  );
});

test('saveRecords() does not write PDR if execution write fails', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    pdrModel,
    knex,
    executionArn,
    pdrName,
  } = t.context;

  delete cumulusMessage.meta.provider;

  await t.throwsAsync(saveRecords(cumulusMessage, knex));

  t.true(await executionModel.exists({ arn: executionArn }));
  t.false(await pdrModel.exists({ pdrName }));

  t.true(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
  t.false(
    await doesRecordExist({
      name: pdrName,
    }, knex, tableNames.pdrs)
  );
});

test('saveRecords() writes records to Dynamo and RDS if cumulus version is less than RDS deployment version', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    knex,
    executionArn,
    pdrName,
    granuleId,
  } = t.context;

  await saveRecords(cumulusMessage, knex);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));

  t.true(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
  t.true(
    await doesRecordExist({
      name: pdrName,
    }, knex, tableNames.pdrs)
  );
  t.true(
    await doesRecordExist({
      granuleId,
    }, knex, tableNames.granules)
  );
});
