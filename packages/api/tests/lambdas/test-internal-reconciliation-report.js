'use strict';

const test = require('ava');
const moment = require('moment');
const flatten = require('lodash/flatten');
const range = require('lodash/range');
const cryptoRandomString = require('crypto-random-string');

const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const { generateGranuleApiRecord } = require('@cumulus/message/Granules');
const { bootstrapElasticSearch } = require('@cumulus/es-client/bootstrap');
const indexer = require('@cumulus/es-client/indexer');
const { getEsClient } = require('@cumulus/es-client/search');

const {
  CollectionPgModel,
  destroyLocalTestDb,
  generateLocalTestDb,
  localStackConnectionEnv,
  translateApiCollectionToPostgresCollection,
  migrationDir,
  translateApiGranuleToPostgresGranule,
  GranulePgModel,
  fakeProviderRecordFactory,
  ProviderPgModel,
  upsertGranuleWithExecutionJoinRecord,
  fakeExecutionRecordFactory,
  ExecutionPgModel,
  FilePgModel,
  translateApiFiletoPostgresFile,
} = require('@cumulus/db');

const {
  fakeCollectionFactory,
  // fakeFileFactory,
  fakeGranuleFactoryV2,
  fakeFileFactory,
} = require('../../lib/testUtils');
const {
  internalRecReportForCollections,
  internalRecReportForGranules,
} = require('../../lambdas/internal-reconciliation-report');
const { normalizeEvent } = require('../../lib/reconciliationReport/normalizeEvent');
const models = require('../../models');

let esAlias;
let esIndex;
let esClient;

test.before((t) => {
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.providerPgModel = new ProviderPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.filePgModel = new FilePgModel();
});

test.beforeEach(async (t) => {
  process.env.ReconciliationReportsTable = randomId('reconciliationTable');

  t.context.bucketsToCleanup = [];
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('bucket');
  process.env.system_bucket = t.context.systemBucket;

  await awsServices.s3().createBucket({ Bucket: t.context.systemBucket })
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));

  await new models.ReconciliationReport().createTable();

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  esClient = await getEsClient();

  t.context.testDbName = `test_internal_recon_${cryptoRandomString({ length: 10 })}`;
  const { knex, knexAdmin } = await generateLocalTestDb(t.context.testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: t.context.testDbName,
  };
});

test.afterEach.always(async (t) => {
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName: t.context.testDbName,
  });
  await Promise.all(
    flatten([
      t.context.bucketsToCleanup.map(recursivelyDeleteS3Bucket),
      new models.ReconciliationReport().deleteTable(),
    ])
  );
  await esClient.client.indices.delete({ index: esIndex });
});

test.serial('internalRecReportForCollections reports discrepancy of collection holdings in ES and DB', async (t) => {
  const { knex, collectionPgModel } = t.context;

  const matchingColls = range(10).map(() => fakeCollectionFactory());
  const extraDbColls = range(2).map(() => fakeCollectionFactory());
  const extraEsColls = range(2).map(() => fakeCollectionFactory());

  const conflictCollInDb = fakeCollectionFactory({ meta: { flag: 'db' } });
  const conflictCollInEs = { ...conflictCollInDb, meta: { flag: 'es' } };

  const esCollections = matchingColls.concat(extraEsColls, conflictCollInEs);
  const dbCollections = matchingColls.concat(extraDbColls, conflictCollInDb);

  await Promise.all(
    esCollections.map((collection) => indexer.indexCollection(esClient, collection, esAlias))
  );

  await Promise.all(
    dbCollections.map((collection) =>
      collectionPgModel.create(
        knex,
        translateApiCollectionToPostgresCollection(collection)
      ))
  );

  let report = await internalRecReportForCollections({});

  t.is(report.okCount, 10);
  t.is(report.onlyInEs.length, 2);
  t.deepEqual(report.onlyInEs.sort(),
    extraEsColls.map((coll) => constructCollectionId(coll.name, coll.version)).sort());
  t.is(report.onlyInDb.length, 2);
  t.deepEqual(report.onlyInDb.sort(),
    extraDbColls.map((coll) => constructCollectionId(coll.name, coll.version)).sort());
  t.is(report.withConflicts.length, 1);
  t.deepEqual(report.withConflicts[0].es.collectionId, conflictCollInEs.collectionId);
  t.deepEqual(report.withConflicts[0].db.collectionId, conflictCollInDb.collectionId);

  // start/end time include all the collections
  const searchParams = {
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };
  report = await internalRecReportForCollections(normalizeEvent(searchParams));
  t.is(report.okCount, 10);
  t.is(report.onlyInEs.length, 2);
  t.is(report.onlyInDb.length, 2);
  t.is(report.withConflicts.length, 1);

  // start/end time has no matching collections
  const paramsTimeOutOfRange = {
    startTimestamp: moment.utc().add(1, 'hour').format(),
    endTimestamp: moment.utc().add(2, 'hour').format(),
  };

  report = await internalRecReportForCollections(normalizeEvent(paramsTimeOutOfRange));
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 0);

  // collectionId matches the collection with conflicts
  const collectionId = constructCollectionId(conflictCollInDb.name, conflictCollInDb.version);
  const paramsCollectionId = { ...searchParams, collectionId: [collectionId, randomId('c')] };

  report = await internalRecReportForCollections(normalizeEvent(paramsCollectionId));
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 1);
});

test.serial('internalRecReportForGranules reports discrepancy of granule holdings in ES and DB', async (t) => {
  const {
    knex,
    collectionPgModel,
    providerPgModel,
    executionPgModel,
  } = t.context;

  // Create collection in PG/ES
  const collectionId = constructCollectionId(randomId('name'), randomId('version'));

  // Create provider in PG
  const provider = fakeProviderRecordFactory();
  await providerPgModel.create(knex, provider);

  const matchingGrans = range(10).map(() => fakeGranuleFactoryV2({
    collectionId,
    provider: provider.name,
  }));
  const additionalMatchingGrans = range(10).map(() => fakeGranuleFactoryV2({
    provider: provider.name,
  }));
  const extraDbGrans = range(2).map(() => fakeGranuleFactoryV2({
    collectionId,
    provider: provider.name,
  }));
  const additionalExtraDbGrans = range(2).map(() => fakeGranuleFactoryV2());
  const extraEsGrans = range(2).map(() => fakeGranuleFactoryV2({
    provider: provider.name,
  }));
  const additionalExtraEsGrans = range(2)
    .map(() => fakeGranuleFactoryV2({
      collectionId,
      provider: provider.name,
    }));
  const conflictGranInDb = fakeGranuleFactoryV2({ collectionId, status: 'completed' });
  const conflictGranInEs = { ...conflictGranInDb, status: 'failed' };

  const esGranules = matchingGrans
    .concat(additionalMatchingGrans, extraEsGrans, additionalExtraEsGrans, conflictGranInEs);
  const dbGranules = matchingGrans
    .concat(additionalMatchingGrans, extraDbGrans, additionalExtraDbGrans, conflictGranInDb);

  // add granules and related collections to es and db
  await Promise.all(
    esGranules.map(async (granule) => {
      const collection = fakeCollectionFactory({
        ...deconstructCollectionId(granule.collectionId),
      });
      await indexer.indexCollection(esClient, collection, esAlias);
      await collectionPgModel.upsert(
        knex,
        translateApiCollectionToPostgresCollection(collection)
      );
      await indexer.indexGranule(esClient, granule, esAlias);
    })
  );

  await Promise.all(
    dbGranules.map(async (granule) => {
      const pgGranule = await translateApiGranuleToPostgresGranule({
        dynamoRecord: granule,
        knexOrTransaction: knex,
      });
      let pgExecution = {};
      if (granule.execution) {
        const pgExecutionData = fakeExecutionRecordFactory({
          url: granule.execution,
        });
        ([pgExecution] = await executionPgModel.create(knex, pgExecutionData));
      }
      return upsertGranuleWithExecutionJoinRecord({
        executionCumulusId: pgExecution.cumulus_id,
        granule: pgGranule,
        knexTransaction: knex,
      });
    })
  );

  let report = await internalRecReportForGranules({ knex });
  t.is(report.okCount, 20);
  t.is(report.onlyInEs.length, 4);
  t.deepEqual(report.onlyInEs.map((gran) => gran.granuleId).sort(),
    extraEsGrans.concat(additionalExtraEsGrans).map((gran) => gran.granuleId).sort());
  t.is(report.onlyInDb.length, 4);
  t.deepEqual(report.onlyInDb.map((gran) => gran.granuleId).sort(),
    extraDbGrans.concat(additionalExtraDbGrans).map((gran) => gran.granuleId).sort());
  t.is(report.withConflicts.length, 1);
  t.deepEqual(report.withConflicts[0].es.granuleId, conflictGranInEs.granuleId);
  t.deepEqual(report.withConflicts[0].db.granuleId, conflictGranInDb.granuleId);

  // start/end time include all the collections and granules
  const searchParams = {
    reportType: 'Internal',
    startTimestamp: moment.utc().subtract(1, 'hour').format(),
    endTimestamp: moment.utc().add(1, 'hour').format(),
  };
  report = await internalRecReportForGranules({
    ...normalizeEvent(searchParams),
    knex,
  });
  t.is(report.okCount, 20);
  t.is(report.onlyInEs.length, 4);
  t.is(report.onlyInDb.length, 4);
  t.is(report.withConflicts.length, 1);

  // start/end time has no matching collections and granules
  const outOfRangeParams = {
    startTimestamp: moment.utc().add(1, 'hour').format(),
    endTimestamp: moment.utc().add(2, 'hour').format(),
  };

  report = await internalRecReportForGranules({
    ...normalizeEvent(outOfRangeParams),
    knex,
  });
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 0);

  // collectionId, provider parameters
  const collectionProviderParams = { ...searchParams, collectionId, provider: provider.name };
  report = await internalRecReportForGranules({
    ...normalizeEvent(collectionProviderParams),
    knex,
  });
  t.is(report.okCount, 10);
  t.is(report.onlyInEs.length, 2);
  t.deepEqual(report.onlyInEs.map((gran) => gran.granuleId).sort(),
    additionalExtraEsGrans.map((gran) => gran.granuleId).sort());
  t.is(report.onlyInDb.length, 2);
  t.deepEqual(report.onlyInDb.map((gran) => gran.granuleId).sort(),
    extraDbGrans.map((gran) => gran.granuleId).sort());
  t.is(report.withConflicts.length, 0);

  // provider parameter
  const providerParams = { ...searchParams, provider: [randomId('p'), provider.name] };
  report = await internalRecReportForGranules({
    ...normalizeEvent(providerParams),
    knex,
  });
  t.is(report.okCount, 20);
  t.is(report.onlyInEs.length, 4);
  t.deepEqual(report.onlyInEs.map((gran) => gran.granuleId).sort(),
    extraEsGrans.concat(additionalExtraEsGrans).map((gran) => gran.granuleId).sort());
  t.is(report.onlyInDb.length, 2);
  t.deepEqual(report.onlyInDb.map((gran) => gran.granuleId).sort(),
    extraDbGrans.map((gran) => gran.granuleId).sort());
  t.is(report.withConflicts.length, 0);

  // collectionId, granuleId parameters
  const granuleId = conflictGranInDb.granuleId;
  const granuleIdParams = {
    ...searchParams,
    granuleId: [granuleId, extraEsGrans[0].granuleId, randomId('g')],
    collectionId: [collectionId, extraEsGrans[0].collectionId, extraEsGrans[1].collectionId],
  };
  report = await internalRecReportForGranules({
    ...normalizeEvent(granuleIdParams),
    knex,
  });
  t.is(report.okCount, 0);
  t.is(report.onlyInEs.length, 1);
  t.is(report.onlyInEs[0].granuleId, extraEsGrans[0].granuleId);
  t.is(report.onlyInDb.length, 0);
  t.is(report.withConflicts.length, 1);
});

test.serial('internalRecReportForGranules handles generated granules with custom timestamps', async (t) => {
  const {
    knex,
    collectionPgModel,
    providerPgModel,
    executionPgModel,
  } = t.context;

  // Create collection in PG/ES
  const collectionId = constructCollectionId(randomId('name'), randomId('version'));
  const collection = fakeCollectionFactory({
    ...deconstructCollectionId(collectionId),
  });
  await indexer.indexCollection(esClient, collection, esAlias);
  await collectionPgModel.upsert(
    knex,
    translateApiCollectionToPostgresCollection(collection)
  );

  // Create provider in PG
  const provider = fakeProviderRecordFactory();
  await providerPgModel.create(knex, provider);

  // Use date string with extra precision to make sure it is saved
  // correctly in dynamo, PG, an Elasticsearch
  const dateString = '2018-04-25T21:45:45.524053';

  await Promise.all(range(5).map(async () => {
    const fakeGranule = fakeGranuleFactoryV2({
      collectionId,
      provider: provider.name,
    });

    const processingTimeInfo = {
      processingStartDateTime: dateString,
      processingEndDateTime: dateString,
    };

    const cmrTemporalInfo = {
      beginningDateTime: dateString,
      endingDateTime: dateString,
      productionDateTime: dateString,
      lastUpdateDateTime: dateString,
    };

    const apiGranule = await generateGranuleApiRecord({
      ...fakeGranule,
      granule: fakeGranule,
      executionUrl: fakeGranule.execution,
      processingTimeInfo,
      cmrTemporalInfo,
    });
    const pgGranule = await translateApiGranuleToPostgresGranule({
      dynamoRecord: apiGranule,
      knexOrTransaction: knex,
    });

    let pgExecution = {};
    if (apiGranule.execution) {
      const pgExecutionData = fakeExecutionRecordFactory({
        url: apiGranule.execution,
      });
      ([pgExecution] = await executionPgModel.create(knex, pgExecutionData));
    }
    await upsertGranuleWithExecutionJoinRecord({
      executionCumulusId: pgExecution.cumulus_id,
      granule: pgGranule,
      knexTransaction: knex,
    });
    await indexer.indexGranule(esClient, apiGranule, esAlias);
  }));

  const report = await internalRecReportForGranules({ knex });
  t.is(report.okCount, 5);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
});

test.serial('internalRecReportForGranules handles granules with files', async (t) => {
  const {
    knex,
    collectionPgModel,
    executionPgModel,
    filePgModel,
  } = t.context;

  // Create collection in PG/ES
  const collectionId = constructCollectionId(randomId('name'), randomId('version'));
  const collection = fakeCollectionFactory({
    ...deconstructCollectionId(collectionId),
  });
  await indexer.indexCollection(esClient, collection, esAlias);
  await collectionPgModel.upsert(
    knex,
    translateApiCollectionToPostgresCollection(collection)
  );
  await Promise.all(range(2).map(async () => {
    const fakeGranule = fakeGranuleFactoryV2({
      collectionId,
      files: [fakeFileFactory(), fakeFileFactory(), fakeFileFactory()],
    });

    const fakeCmrUtils = {
      getGranuleTemporalInfo: () => Promise.resolve({}),
    };
    const apiGranule = await generateGranuleApiRecord({
      ...fakeGranule,
      granule: fakeGranule,
      executionUrl: fakeGranule.execution,
      cmrUtils: fakeCmrUtils,
    });
    const pgGranule = await translateApiGranuleToPostgresGranule({
      dynamoRecord: apiGranule,
      knexOrTransaction: knex,
    });

    const pgExecutionData = fakeExecutionRecordFactory({
      url: apiGranule.execution,
    });
    const [pgExecution] = await executionPgModel.create(knex, pgExecutionData);

    const [pgGranuleRecord] = await upsertGranuleWithExecutionJoinRecord({
      executionCumulusId: pgExecution.cumulus_id,
      granule: pgGranule,
      knexTransaction: knex,
    });
    await Promise.all(apiGranule.files.map(async (file) => {
      const pgFile = translateApiFiletoPostgresFile(file);
      await filePgModel.create(knex, {
        ...pgFile,
        granule_cumulus_id: pgGranuleRecord.cumulus_id,
      });
    }));
    await indexer.indexGranule(esClient, apiGranule, esAlias);
  }));

  const report = await internalRecReportForGranules({ knex });
  t.is(report.okCount, 2);
  t.is(report.onlyInEs.length, 0);
  t.is(report.onlyInDb.length, 0);
});
