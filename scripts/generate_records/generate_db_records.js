/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-await-in-loop */
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

function* yieldCollectionDetails(total, repeatable) {
  for (let i = 0; i < total; i += 1) {
    let suffix;
    if (repeatable) {
      suffix = `__test${i.toString().padStart(2, '0')}`;
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
    uploadFiles(knex, granuleOutput.cumulus_id, filesPerGranule);
    granules.push(granuleOutput);
  }

  return granules;
};

const uploadGranuleExecutions = async (knex, granules, executions) => {
  const GEmodel = new GranulesExecutionsPgModel();
  await Promise.all(granules.map(
    async (granule) => await Promise.all(executions.map(async (execution) => {
      await GEmodel.upsert(
        knex,
        { granule_cumulus_id: granule.cumulus_id, execution_cumulus_id: execution.cumulus_id }
      );
    }))
  ));
};

const uploadDataBunch = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  granuleCount,
  executionCount,
  filesPerGranule
) => {
  const granules = await uploadGranules(
    knex,
    collectionCumulusId,
    providerCumulusId,
    granuleCount,
    filesPerGranule
  );
  const executions = await uploadExecutions(
    knex,
    collectionCumulusId,
    executionCount
  );
  await uploadGranuleExecutions(knex, granules, executions);
};

const uploadDBGranules = async (providerId, collection, batchSize, granuleCount) => {
  process.env.dbMaxPool = batchSize || 10;
  const knex = await getKnexClient();

  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();

  const dbCollection = await collectionPgModel.get(
    knex,
    { name: collection.name, version: collection.version }
  );
  const dbProvider = await providerPgModel.get(knex, { name: providerId });

  let promises = [];
  for (let iter = 1; iter < granuleCount; iter += 10) {
    console.log(`uploading granule ${iter} for collection ${collection.name}`);
    const promise = uploadDataBunch(
      knex,
      dbCollection.cumulus_id,
      dbProvider.cumulus_id,
      2,
      1,
      2
    );

    promises.push(promise);
    if (promises.length > batchSize) {
      await promises[0];
      promises = promises.slice(1);
    }
  }
};
const createCollection = async (stackName, internalBucket, providerId, collection) => {
  await addCollection(stackName, internalBucket, collection.suffix);
  await uploadDBGranules(providerId, collection, 10, 20);
};
const main = async () => {
  const stackName = 'ecarton-ci-tf';
  const internalBucket = 'cumulus-test-sandbox-protected';
  const providerId = await addProvider(stackName, internalBucket, 'a');
  for (const collection of yieldCollectionDetails(5, true)) {
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
