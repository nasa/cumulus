/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-await-in-loop */
const pMap = require('p-map');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs-extra');
const {
  addCollections,
} = require('@cumulus/integration-tests');
const apiTestUtils = require('@cumulus/integration-tests/api/api');
const {
  GranulePgModel,
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  FilePgModel,
  getKnexClient,
  fakeGranuleRecordFactory,
  fakeFileRecordFactory,
  fakeExecutionRecordFactory,
} = require('@cumulus/db');
process.env.DISABLE_PG_SSL = true;
const collectionsDir = 'resources/collections/';

const createTimestampedTestId = (stackName, testName) =>
  `${stackName}-${testName}-${Date.now()}`;

function* yieldCollectionDetails(total, repeatable=true) {
  for (let i = 0; i < total; i += 1) {
    let suffix;
    if (repeatable) {
      suffix = `_test_generator${i.toString().padStart(2, '0')}`;
    } else {
      suffix = `_${cryptoRandomString({ length: 5 }).toUpperCase()}`;
    }
    yield {
      name: `MOD09GQ${suffix}`,
      version: '006',
      suffix,
    };
  }
}
const addCollection = async (stackName, bucket, collectionSuffix) => {
  const testId = createTimestampedTestId(stackName, 'IngestGranuleSuccess');
  console.log('pushing up collection with suffix', collectionSuffix);
  try {
    await addCollections(
      stackName,
      bucket,
      collectionsDir,
      collectionSuffix,
      testId,
      'replace'
    );
  } catch (error) {
    if (error.statusCode === 409) {
      return;
    }
    throw error;
  }
};
const addProvider = async (stackName, bucket) => {
  const providerId = 's3_provider_test';
  const providerJson = JSON.parse(fs.readFileSync('resources/s3_provider.json', 'utf8'));
  const providerData = {
    ...providerJson,
    id: providerId,
    host: bucket,
  };
  try {
    await apiTestUtils.addProviderApi({
      prefix: stackName,
      provider: providerData,
    });
  } catch (error) {
    if (error.statusCode === 409) {
      return providerId;
    }
    throw error;
  }
  return providerId;
};

const uploadFiles = async (knex, granuleCumulusId, fileCount) => {
  const files = [];
  const fileModel = new FilePgModel();
  for (let i = 0; i < fileCount; i += 1) {
    const file = fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
    });
    const [fileOutput] = await fileModel.upsert(knex, file);
    files.push(fileOutput);
  }
  return files;
};
const uploadExecutions = async (knex, collectionCumulusId, executionCount) => {
  const executions = [];
  const executionModel = new ExecutionPgModel();
  for (let i = 0; i < executionCount; i += 1) {
    const execution = fakeExecutionRecordFactory({ collection_cumulus_id: collectionCumulusId });
    const [executionOutput] = await executionModel.upsert(knex, execution);
    executions.push(executionOutput);
  }
  return executions;
};
const uploadGranules = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  granuleCount,
  filesPerGranule
) => {
  const granules = [];
  const granuleModel = new GranulePgModel();
  for (let i = 0; i < granuleCount; i += 1) {
    const granule = fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
      status: 'completed',
    });
    const [granuleOutput] = await granuleModel.upsert({
      knexOrTrx: knex,
      granule,
    });
    granules.push(granuleOutput);
    uploadFiles(knex, granuleOutput.cumulus_id, filesPerGranule);
  }

  return granules;
};

const uploadGranuleExecutions = async (knex, granules, executions) => {
  const GEmodel = new GranulesExecutionsPgModel();
  for (let i = 0; i < granules.length; i += 1) {
    for (let j = 0; j < executions.length; j += 1) {
      await GEmodel.upsert(
        knex,
        {
          granule_cumulus_id: granules[i].cumulus_id,
          execution_cumulus_id: executions[j].cumulus_id,
        }
      );
    }
  }

};

const uploadDataBunch = async ({
  knex,
  collectionCumulusId,
  providerCumulusId,
  files,
  batchGranules,
  batchExecutions,
}) => {
  const granules = await uploadGranules(
    knex,
    collectionCumulusId,
    providerCumulusId,
    batchGranules,
    files
  );
  const executions = await uploadExecutions(
    knex,
    collectionCumulusId,
    batchExecutions
  );
  await uploadGranuleExecutions(knex, granules, executions);
};

const uploadDBGranules = async (
  providerId,
  collection,
  granuleCount,
  granulesPerBatch,
  filesPerGranule,
  executionsPerBatch,
  parallelism
) => {
  process.env.dbMaxPool = parallelism || 10;
  const knex = await getKnexClient();

  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();

  const dbCollection = await collectionPgModel.get(
    knex,
    { name: collection.name, version: collection.version }
  );
  const dbProvider = await providerPgModel.get(knex, { name: providerId });
  const arg = {
    knex,
    collectionCumulusId: dbCollection.cumulus_id,
    providerCumulusId: dbProvider.cumulus_id,
    granuleCount: granulesPerBatch,
    filesPerGranule,
    executionCount: executionsPerBatch,
  };

  const fakeIterable = {};
  fakeIterable[Symbol.iterator] = function* fakeYielder() {
    for (let i = 0; i < granuleCount / granulesPerBatch; i += 1) {
      console.log(i * granulesPerBatch);
      yield arg;
    }
  };
  await pMap(
    fakeIterable,
    uploadDataBunch,
    { concurrency: parallelism }
  );
};
const createCollection = async (stackName, internalBucket, providerId, collection) => {
  await addCollection(stackName, internalBucket, collection.suffix);
  await uploadDBGranules(providerId, collection, 10000, 5, 6, 2);
};
const main = async () => {
  const stackName = 'ecarton-ci-tf';
  const internalBucket = 'cumulus-test-sandbox-protected';
  const providerId = await addProvider(stackName, internalBucket, 'a');
  for (const collection of yieldCollectionDetails(1, true)) {
    await createCollection(stackName, internalBucket, providerId, collection);
  }
};

if (require.main === module) {
  main(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}
