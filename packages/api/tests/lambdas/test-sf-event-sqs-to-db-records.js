'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const uuidv4 = require('uuid/v4');

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

const { migrationDir } = require('../../../../lambdas/db-migration');

const sandbox = sinon.createSandbox();
const stubRecordExists = sandbox.stub().resolves(true);

const {
  handler,
  isPostRDSDeploymentExecution,
  hasNoParentExecutionOrExists,
  hasNoAsyncOpOrExists,
  getMessageCollectionCumulusId,
  getMessageProviderCumulusId,
  shouldWriteExecutionToRDS,
  writeGranules,
  writeExecution,
  writePdr,
  writeRecords,
} = proxyquire('../../lambdas/sf-event-sqs-to-db-records', {
  '@cumulus/aws-client/SQS': {
    sendSQSMessage: async (queue, message) => [queue, message],
  },
  '@cumulus/aws-client/StepFunctions': {
    describeExecution: async () => ({}),
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

  t.context.testDbName = `sfEventSqsToDbRecords_${cryptoRandomString({ length: 10 })}`;

  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  await t.context.knexAdmin.raw(`create database "${t.context.testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${t.context.testDbName}" to "${localStackConnectionEnv.PG_USER}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: t.context.testDbName,
      migrationDir,
    },
  });
  await t.context.knex.migrate.latest();
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
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${t.context.testDbName}"`);
  await t.context.knexAdmin.destroy();
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

test('getMessageCollectionCumulusId returns correct collection cumulusId', async (t) => {
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

  t.is(
    await getMessageCollectionCumulusId(cumulusMessage, fakeKnex),
    5
  );
});

test('getMessageCollectionCumulusId returns undefined if there is no collection on the message', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageCollectionCumulusId({}, knex), undefined);
});

test('getMessageCollectionCumulusId returns undefined if collection cannot be found', async (t) => {
  const { cumulusMessage, knex } = t.context;
  cumulusMessage.meta.collection.name = 'fake-collection-name';
  t.is(await getMessageCollectionCumulusId(cumulusMessage, knex), undefined);
});

test('getMessageProviderCumulusId returns cumulusId of provider in message', async (t) => {
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

  t.is(
    await getMessageProviderCumulusId(cumulusMessage, fakeKnex),
    234
  );
});

test('getMessageProviderCumulusId returns undefined if there is no provider in the message', async (t) => {
  const { knex } = t.context;
  t.is(await getMessageProviderCumulusId({}, knex), undefined);
});

test('getMessageProviderCumulusId returns undefined if provider cannot be found', async (t) => {
  const { cumulusMessage, knex } = t.context;
  cumulusMessage.meta.provider.id = 'bogus-provider-id';
  t.is(await getMessageProviderCumulusId(cumulusMessage, knex), undefined);
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
    1,
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
      1,
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
    await shouldWriteExecutionToRDS(cumulusMessage, collectionCumulusId, knex)
  );
});

test('shouldWriteExecutionToRDS returns false if collection cumulusId is not defined', async (t) => {
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
    await shouldWriteExecutionToRDS(cumulusMessage, collectionCumulusId, knex)
  );
});

test('writeExecution() saves execution to Dynamo and RDS and returns cumulusId if write to RDS is enabled', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
  } = t.context;

  const executionCumulusId = await writeExecution({ cumulusMessage, knex });

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(
    await doesRecordExist({
      cumulusId: executionCumulusId,
    }, knex, tableNames.executions)
  );
});

test.serial('writeExecution() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
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
    writeExecution({
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

test.serial('writeExecution() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
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
    writeExecution({ cumulusMessage, knex }),
    { message: 'execution RDS error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
});

test('writePdr() returns true if there is no PDR on the message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  delete cumulusMessage.payload.pdr;

  t.is(
    await writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
    }),
    undefined
  );
});

test('writePdr() throws an error if collection is not provided', async (t) => {
  const { cumulusMessage, knex, providerCumulusId } = t.context;
  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId: undefined,
      providerCumulusId,
      knex,
    })
  );
});

test('writePdr() throws an error if provider is not provided', async (t) => {
  const { cumulusMessage, knex, collectionCumulusId } = t.context;
  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId: undefined,
      knex,
    })
  );
});

test('writePdr() saves a PDR record to Dynamo and RDS and returns cumulusId if RDS write is enabled', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    pdr,
  } = t.context;

  const pdrCumulusId = await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  });

  t.true(await pdrModel.exists({ pdrName: pdr.name }));
  t.true(
    await doesRecordExist({
      cumulusId: pdrCumulusId,
    }, knex, tableNames.pdrs)
  );
});

test.serial('writePdr() does not persist records Dynamo or RDS if Dynamo write fails', async (t) => {
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
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
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

test.serial('writePdr() does not persist records Dynamo or RDS if RDS write fails', async (t) => {
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
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
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

test('writeGranules() returns true if there are no granules in the message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  delete cumulusMessage.payload.granules;

  t.true(
    await writeGranules({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
    })
  );
});

test('writeGranules() throws an error if collection is not provided', async (t) => {
  const { cumulusMessage, knex, providerCumulusId } = t.context;
  await t.throwsAsync(
    writeGranules({
      cumulusMessage,
      collectionCumulusId: undefined,
      providerCumulusId,
      knex,
    })
  );
});

test('writeGranules() saves granule records to Dynamo and RDS if RDS write is enabled', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(
    await doesRecordExist({ granuleId }, knex, tableNames.granules)
  );
});

test('writeGranules() handles successful and failing writes independently', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const granule2 = {
    // no granule ID should cause failure
  };
  cumulusMessage.payload.granules = [
    ...cumulusMessage.payload.granules,
    granule2,
  ];

  const results = await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(
    await doesRecordExist({ granuleId }, knex, tableNames.granules)
  );
  t.is(results.filter((result) => result.status === 'rejected').length, 1);
});

test.serial('writeGranules() does not persist records to Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeGranuleModel = {
    storeGranuleFromCumulusMessage: () => {
      throw new Error('Granules dynamo error');
    },
  };

  const results = await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
    granuleModel: fakeGranuleModel,
  });

  const [failure] = results.filter((result) => result.status === 'rejected');
  t.is(failure.reason.message, 'Granules dynamo error');
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await doesRecordExist({ granuleId }, knex, tableNames.granules)
  );
});

test.serial('writeGranules() does not persist records to Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('Granules RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  const results = await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    knex,
  });

  const [failure] = results.filter((result) => result.status === 'rejected');
  t.is(failure.reason.message, 'Granules RDS error');
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await doesRecordExist({ granuleId }, knex, tableNames.granules)
  );
});

test('writeRecords() only writes records to Dynamo if cumulus version is less than RDS deployment version', async (t) => {
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

  await writeRecords(cumulusMessage, knex);

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

test('writeRecords() does not write PDR if execution write fails', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    pdrModel,
    knex,
    executionArn,
    pdrName,
  } = t.context;

  delete cumulusMessage.meta.status;

  await t.throwsAsync(writeRecords(cumulusMessage, knex));

  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(await pdrModel.exists({ pdrName }));

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
});

test('writeRecords() writes records to Dynamo and RDS if cumulus version is less than RDS deployment version', async (t) => {
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

  await writeRecords(cumulusMessage, knex);

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

test.serial('Lambda sends message to DLQ when RDS_DEPLOYMENT_CUMULUS_VERSION env var is missing', async (t) => {
  const {
    cumulusMessage,
  } = t.context;

  delete process.env.RDS_DEPLOYMENT_CUMULUS_VERSION;
  const {
    handlerResponse,
    sqsEvent,
  } = await runHandler(cumulusMessage);

  t.is(handlerResponse[0][1].body, sqsEvent.Records[0].body);
});

test('Lambda sends message to DLQ when an execution/PDR write to the database fails', async (t) => {
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
