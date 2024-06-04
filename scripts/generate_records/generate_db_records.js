/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-await-in-loop */
const pMap = require('p-map');
const minimist = require('minimist');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs-extra');
const {
  addCollections,
} = require('@cumulus/integration-tests');
const apiTestUtils = require('@cumulus/integration-tests/api/api');
const { getRequiredEnvVar } = require('@cumulus/common/env');
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
const { randomInt } = require('crypto');
process.env.DISABLE_PG_SSL = true;
const collectionsDir = 'resources/collections/';

const createTimestampedTestId = (stackName, testName) =>
  `${stackName}-${testName}-${Date.now()}`;

function* yieldCollectionDetails(total, repeatable = true) {
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
  granules,
  files,
  executionsPerBatch,
  granulesPerBatch,
  concurrency,
  variance
) => {
  process.env.dbMaxPool = concurrency;
  const knex = await getKnexClient();

  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();

  const dbCollection = await collectionPgModel.get(
    knex,
    { name: collection.name, version: collection.version }
  );
  const dbProvider = await providerPgModel.get(knex, { name: providerId });
  const collectionCumulusId = dbCollection.cumulus_id;
  const providerCumulusId = dbProvider.cumulus_id;

  const fakeIterable = {};
  fakeIterable[Symbol.iterator] = function* fakeYielder() {
    let batchGranules = 1;
    for (let i = 0; i < granules; i += batchGranules) {
      console.log(i);
      batchGranules = granulesPerBatch + (variance ? randomInt(6) : 0);
      const batchExecutions = executionsPerBatch + (variance ? randomInt(5) : 0);
      yield {
        knex,
        collectionCumulusId,
        providerCumulusId,
        files,
        batchGranules,
        batchExecutions,
      };
    }
  };
  await pMap(
    fakeIterable,
    uploadDataBunch,
    { concurrency }
  );
};

const parseArgs = () => {
  const {
    granules,
    files,
    executionsPerBatch,
    granulesPerBatch,
    collections,
    variance,
    concurrency,
  } = minimist(
    process.argv,
    {
      string: [
        'collections',
        'files',
        'granules',
        'executionsPerBatch',
        'granulesPerBatch',
        'concurrency',
      ],
      boolean: [
        'variance',
      ],
      default: {
        collections: 1,
        files: 1,
        granules: 10000,
        executionsPerBatch: 1,
        granulesPerBatch: 1,
        variance: true,
        concurrency: 1,
      },
    }
  );
  return {
    granules: Number.parseInt(granules, 10),
    files: Number.parseInt(files, 10),
    granulesPerBatch: Number.parseInt(granulesPerBatch, 10),
    executionsPerBatch: Number.parseInt(executionsPerBatch, 10),
    collections: Number.parseInt(collections, 10),
    concurrency: Number.parseInt(concurrency, 10),
    variance,
  };
};

const main = async () => {
  const {
    granules,
    files,
    executionsPerBatch,
    granulesPerBatch,
    collections,
    variance,
    concurrency,
  } = parseArgs();

  const stackName = getRequiredEnvVar('DEPLOYMENT');
  const internalBucket = getRequiredEnvVar('INTERNAL_BUCKET');
  const providerId = await addProvider(stackName, internalBucket, 'a');
  for (const collection of yieldCollectionDetails(collections, true)) {
    await addCollection(stackName, internalBucket, collection.suffix);
    await uploadDBGranules(
      providerId,
      collection,
      granules,
      files,
      executionsPerBatch,
      granulesPerBatch,
      concurrency,
      variance
    );
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
