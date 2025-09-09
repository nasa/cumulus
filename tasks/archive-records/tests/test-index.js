'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  randomId
} = require('@cumulus/common/test-utils');

const sinon = require('sinon');
const {
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
  GranulePgModel,
  CollectionPgModel,
  fakeExecutionRecordFactory,
  ExecutionPgModel,
  localStackConnectionEnv,
  translateApiCollectionToPostgresCollection,
} = require('@cumulus/db');
const range = require('lodash/range');
const { handler } = require('../dist/src');
const { fakeGranuleRecordFactory, fakeCollectionRecordFactory } = require('@cumulus/db/dist');
const { bulkArchiveGranules } = require('@cumulus/api/endpoints/granules');
const { bulkArchiveExecutions } = require('@cumulus/api/endpoints/executions');
const mockResponse = () => {
  const res = {};
  res.status = sinon.stub().returns(res);
  res.send = sinon.stub().returns(res);
  res.badRequest = sinon.stub().returns(res);
  return res;
};
const epochDay = 86400000;

async function setupDataStoreData(granules, executions, t) {
  const { knex } = t.context;
  const granuleModel = new GranulePgModel();
  const executionModel = new ExecutionPgModel();
  const collectionModel = new CollectionPgModel();

  const collection = fakeCollectionRecordFactory({
    name: 'MOD11A1',
    granuleIdExtraction: '(MOD11A1\\.(.*))\\.hdf',
    granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
    dataType: 'MOD11A1',
    process: 'modis',
    version: '006',
    sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    id: 'MOD11A1',
  });
  const collectionInserted = await collectionModel.create(
    knex,
    translateApiCollectionToPostgresCollection(collection)
  );
  const pgGranules = await granuleModel.create(
    knex,
    granules.map((granule) => ({
      ...granule,
      collection_cumulus_id: collectionInserted[0].cumulus_id
    })),
    ['cumulus_id']
  );
  const pgExecutions = await executionModel.create(
    knex,
    executions,
    ['cumulus_id']
  );
  return {
    pgGranules,
    pgExecutions,
  };
}

const archiveGranulesDummyMethod = async (params) => {
  await bulkArchiveGranules(params, mockResponse());
  return { body: JSON.stringify({ recordsUpdated: 0 }) };
}

const archiveExecutionsDummyMethod = async (params) => {
  await bulkArchiveExecutions(params, mockResponse());
  return { body: JSON.stringify({ recordsUpdated: 0 }) };
}
test.beforeEach(async (t) => {
  const testDbName = `ArchiveRecords/${cryptoRandomString({ length: 10 })}`;
  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );

  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
  t.context.stackName = randomId('ArchiveRecords');
  
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    stackName: t.context.stackName,
  };
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
});

test.serial('ArchiveRecords sets old granules/executions to "archived=true"', async (t) => {

  const config = {
    expirationDays: 1,
    testMethods: {
      archiveGranulesMethod: archiveGranulesDummyMethod,
      archiveExecutionsMethod: archiveExecutionsDummyMethod,
    }
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    [fakeGranuleRecordFactory({
      granule_id: cryptoRandomString({ length: 5 }),
      updated_at: new Date(Date.now() - 2*epochDay),
    })],
    [fakeExecutionRecordFactory({
      updated_at: new Date(Date.now() - 2*epochDay)
    })],
    t
  );
  await handler({config});
  const granuleModel = new GranulePgModel();
  const granuleCumulusId = pgGranules[0].cumulus_id;
  const granule = await granuleModel.get(
    t.context.knex,
    {
      cumulus_id: granuleCumulusId
    }
  )
  t.true(granule.archived)

  const executionModel = new ExecutionPgModel();
  const executionCumulusId = pgExecutions[0].cumulus_id;
  const execution = await executionModel.get(
    t.context.knex,
    {
      cumulus_id: executionCumulusId
    }
  )
  t.true(execution.archived)
});

test.serial('ArchiveRecords sets old granules to "archived=true" and not newer granules/executions', async (t) => {
  const config = {
    expirationDays: 5,
    testMethods: {
      archiveGranulesMethod: archiveGranulesDummyMethod,
      archiveExecutionsMethod: archiveExecutionsDummyMethod,
    }
  };
  const { pgGranules, pgExecutions } = await setupDataStoreData(
    range(100).map((i) => fakeGranuleRecordFactory({
      granule_id: `${i}`,
      updated_at: new Date(Date.now() - i * epochDay),
    })),
    range(100).map((i) => fakeExecutionRecordFactory({
      arn: `${i}`,
      updated_at: new Date(Date.now() - i * epochDay),
    })),
    t
  );
  await handler({config});
  const granuleModel = new GranulePgModel();
  const granules = await Promise.all(
    pgGranules.map(async (granule) => await granuleModel.get(
      t.context.knex,
      {
        cumulus_id: granule.cumulus_id
      }
    ))
  );
  granules.forEach((granule) => {
    if (parseInt(granule.granule_id) <= config.expirationDays) {
      t.false(granule.archived);
    } else {
      t.true(granule.archived);
    }
  })

  const executionModel = new ExecutionPgModel();
  const executions = await Promise.all(
    pgExecutions.map(async (execution) => await executionModel.get(
      t.context.knex,
      {
        cumulus_id: execution.cumulus_id
      }
    ))
  );
  executions.forEach((execution) => {
    if (parseInt(execution.arn) <= config.expirationDays) {
      t.false(execution.archived);
    } else {
      t.true(execution.archived);
    }
  })
});

// test.serial('changeGranuleCollectionsPG should handle change where only some files are being moved', async (t) => {
//   const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
//   let payloadString = fs.readFileSync(payloadPath, 'utf8');
//   payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
//   payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
//   payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
//   t.context.payload = JSON.parse(payloadString);

//   t.context.payload.config.oldGranules[0].files[0] = t.context.payload.input.granules[0].files[0];
//   t.context.payload.config.oldGranules[0].files[1] = t.context.payload.input.granules[0].files[1];

//   await setupS3Data(t.context.payload.input.granules);
//   await setupS3Data(t.context.payload.config.oldGranules);
//   const collectionPath = path.join(__dirname, 'data', 'new_collection.json');
//   const collection = JSON.parse(fs.readFileSync(collectionPath));
//   const newPayload = buildPayload(t, collection);
//   const pgRecords = await setupDataStoreData(
//     newPayload.config.oldGranules,
//     collection,
//     t
//   );
//   const output = await changeGranuleCollectionsPG(newPayload);
//   await validateOutput(t, output);
//   const granuleModel = new GranulePgModel();
//   const finalPgGranule = await granuleModel.get(t.context.knex, {
//     cumulus_id: pgRecords.granules[0].cumulus_id,
//   });
//   t.assert(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
//   t.assert(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
//   //ensure old files have been cleaned up

//   await Promise.all(newPayload.config.oldGranules.slice(2).map((granule) => Promise.all(
//     granule.files.map(async (file) => {
//       t.assert(!await s3ObjectExists({
//         Bucket: file.bucket,
//         Key: file.key,
//       }));
//     })
//   )));
//   await Promise.all(newPayload.input.granules.map((granule) => Promise.all(
//     granule.files.map(async (file) => {
//       t.assert(await s3ObjectExists({
//         Bucket: file.bucket,
//         Key: file.key,
//       }));
//     })
//   )));
// });

// test.serial('changeGranuleCollectionsPG should handle change where no files are being moved', async (t) => {
//   const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
//   let payloadString = fs.readFileSync(payloadPath, 'utf8');
//   payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
//   payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
//   payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
//   t.context.payload = JSON.parse(payloadString);

//   t.context.payload.config.oldGranules[0].files = t.context.payload.input.granules[0].files;
//   await setupS3Data(t.context.payload.input.granules);
//   await setupS3Data(t.context.payload.config.oldGranules);
//   const collectionPath = path.join(__dirname, 'data', 'new_collection.json');
//   const collection = JSON.parse(fs.readFileSync(collectionPath));
//   const newPayload = buildPayload(t, collection);
//   const pgRecords = await setupDataStoreData(
//     newPayload.config.oldGranules,
//     collection,
//     t
//   );
//   const output = await changeGranuleCollectionsPG(newPayload);
//   await validateOutput(t, output);
//   const granuleModel = new GranulePgModel();
//   const finalPgGranule = await granuleModel.get(t.context.knex, {
//     cumulus_id: pgRecords.granules[0].cumulus_id,
//   });
//   t.assert(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
//   t.assert(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
//   //nothing should have been cleaned up

//   await Promise.all(newPayload.input.granules.map((granule) => Promise.all(
//     granule.files.map(async (file) => {
//       t.assert(await s3ObjectExists({
//         Bucket: file.bucket,
//         Key: file.key,
//       }));
//     })
//   )));
// });

// test.serial('changeGranuleCollectionsPG Should work correctly for a large batch', async (t) => {
//   const payloadPath = path.join(__dirname, 'data', 'payload_base.json');
//   let payloadString = fs.readFileSync(payloadPath, 'utf8');
//   payloadString = payloadString.replaceAll('replaceme-publicBucket', t.context.publicBucket);
//   payloadString = payloadString.replaceAll('replaceme-privateBucket', t.context.privateBucket);
//   payloadString = payloadString.replaceAll('replaceme-protectedBucket', t.context.protectedBucket);
//   t.context.payload = JSON.parse(payloadString);

//   const collectionPath = path.join(__dirname, 'data', 'new_collection.json');
//   const collection = JSON.parse(fs.readFileSync(collectionPath));
//   const newPayload = buildPayload(t, collection);
//   const granules = range(200).map((_) => fakeGranuleRecordFactory({
//     granuleId: cryptoRandomString({ length: 5 }),
//     collectionId: constructCollectionId(
//       t.context.payload.config.collection.name,
//       t.context.payload.config.collection.version
//     ),
//     updated_at: Date.now() - (i * epochDay) // i days ago
//   }));

//   const pgRecords = await setupDataStoreData(
//     granules,
//     collection,
//     t
//   );
//   const output = await archiveRecords(newPayload);
//   await validateOutput(t, output);
//   const granuleModel = new GranulePgModel();
//   const finalPgGranule = await granuleModel.get(t.context.knex, {
//     cumulus_id: pgRecords.granules[0].cumulus_id,
//   });
//   t.assert(finalPgGranule.granule_id === pgRecords.granules[0].granule_id);
//   t.assert(finalPgGranule.collection_cumulus_id === pgRecords.targetCollection.cumulus_id);
//   //ensure old files have been cleaned up

//   await Promise.all(newPayload.config.oldGranules.map((granule) => Promise.all(
//     granule.files.map(async (file) => {
//       t.assert(!await s3ObjectExists({
//         Bucket: file.bucket,
//         Key: file.key,
//       }));
//     })
//   )));
//   await Promise.all(newPayload.input.granules.map((granule) => Promise.all(
//     granule.files.map(async (file) => {
//       t.assert(await s3ObjectExists({
//         Bucket: file.bucket,
//         Key: file.key,
//       }));
//     })
//   )));
// });

// test('massageConfig massages input config to contain required variables', (t) => {
//   let config = {
//     oldGranules: [],
//     targetCollection: {
//       name: 'abc',
//       version: '001',
//     },
//     collection: {
//       name: 'abc',
//       version: '000',
//     },
//     concurrency: 120,
//     s3Concurrency: 123,
//     dbMaxPool: 200,
//     maxRequestGranules: 20000,
//   };
//   let massagedConfig = massageConfig(config);
//   t.deepEqual(config, massagedConfig);

//   config = {
//     oldGranules: [],
//     targetCollection: {
//       name: 'abc',
//       version: '001',
//     },
//     collection: {
//       name: 'abc',
//       version: '000',
//     },
//   };
//   massagedConfig = massageConfig(config);
//   t.deepEqual({
//     ...config,
//     concurrency: 100,
//     s3Concurrency: 50,
//     maxRequestGranules: 1000,
//     dbMaxPool: 100,
//   }, massagedConfig);
//   const oldEnv = clone(process.env);
//   process.env = {
//     ...process.env,
//     concurrency: 1,
//     s3Concurrency: 2,
//     maxRequestGranules: 3,
//     dbMaxPool: 4,
//   };
//   config = {
//     oldGranules: [],
//     targetCollection: {
//       name: 'abc',
//       version: '001',
//     },
//     collection: {
//       name: 'abc',
//       version: '000',
//     },
//   };
//   massagedConfig = massageConfig(config);
//   t.deepEqual({
//     ...config,
//     concurrency: 1,
//     s3Concurrency: 2,
//     maxRequestGranules: 3,
//     dbMaxPool: 4,
//   }, massagedConfig);
//   process.env = oldEnv;
// });
