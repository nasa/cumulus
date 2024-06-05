/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-await-in-loop */
const pMap = require('p-map');
const minimist = require('minimist');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs-extra');
const {
  addCollections,
} = require('@cumulus/integration-tests');
const Logger = require('@cumulus/logger');
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

const log = new Logger({
  sender: '@cumulus/generate_records',
});

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
  log.info('pushing up collection with suffix', collectionSuffix);
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

const uploadFiles = async (knex, granuleCumulusId, fileCount, models) => {
  const fileModel = models.fileModel;
  for (let i = 0; i < fileCount; i += 1) {
    const file = fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
    });
    try {
      await fileModel.upsert(knex, file);
    } catch (error) {
      log.error(`failed up upload file: ${error}`);
    }
  }
};
const uploadExecutions = async (knex, collectionCumulusId, executionCount, models) => {
  const executions = [];
  const executionModel = models.executionModel;
  for (let i = 0; i < executionCount; i += 1) {
    const execution = fakeExecutionRecordFactory({ collection_cumulus_id: collectionCumulusId });
    try {
      const [executionOutput] = await executionModel.upsert(knex, execution);
      executions.push(executionOutput);
    } catch (error) {
      log.error(`failed up upload execution: ${error}`);
    }
  }
  return executions;
};
const uploadGranules = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  granuleCount,
  filesPerGranule,
  models
) => {
  const granules = [];
  const granuleModel = models.granuleModel;
  for (let i = 0; i < granuleCount; i += 1) {
    const granule = fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
      status: 'completed',
    });
    try {
      const [granuleOutput] = await granuleModel.upsert({
        knexOrTrx: knex,
        granule,
      });
      granules.push(granuleOutput);
      uploadFiles(knex, granuleOutput.cumulus_id, filesPerGranule, models);
    } catch (error) {
      log.error(`failed up upload granule: ${error}`);
    }
  }
  return granules;
};

const uploadGranuleExecutions = async (knex, granules, executions, models) => {
  const GEmodel = models.geModel;
  for (let i = 0; i < granules.length; i += 1) {
    for (let j = 0; j < executions.length; j += 1) {
      try {
        await GEmodel.upsert(
          knex,
          {
            granule_cumulus_id: granules[i].cumulus_id,
            execution_cumulus_id: executions[j].cumulus_id,
          }
        );
      } catch (error) {
        log.error(`failed up upload granuleExecution: ${error}`);
      }
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
  models,
}) => {
  const granules = await uploadGranules(
    knex,
    collectionCumulusId,
    providerCumulusId,
    batchGranules,
    files,
    models
  );
  const executions = await uploadExecutions(
    knex,
    collectionCumulusId,
    batchExecutions,
    models
  );
  await uploadGranuleExecutions(knex, granules, executions, models);
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
  const models = {
    geModel: new GranulesExecutionsPgModel(),
    executionModel: new ExecutionPgModel(),
    granuleModel: new GranulePgModel(),
    fileModel: new FilePgModel(),
  };
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
        models,
      };
    }
  };
  await pMap(
    fakeIterable,
    uploadDataBunch,
    { concurrency }
  );
};

const parseExecutionsGranulesBatch = (executionsPerGranule) => {
  // expect to come in format 'x:y'
  try {
    const split = executionsPerGranule.split(':');
    const executionsPerBatch = Number.parseInt(split[0], 10);
    const granulesPerBatch = Number.parseInt(split[1], 10);
    return { executionsPerBatch, granulesPerBatch };
  } catch (error) {
    throw new Error(`cannot parse ${executionsPerGranule}, expected format <executions>:<granules> ratio \n${error}`);
  }
};

const parseArgs = () => {
  const {
    granulesK,
    files,
    executionsPerGranule,
    collections,
    variance,
    concurrency,
  } = minimist(
    process.argv,
    {
      string: [
        'collections',
        'files',
        'granulesK',
        'executionsPerGranule',
        'concurrency',
      ],
      boolean: [
        'variance',
      ],
      alias: {
        num_collections: 'collections',
        granules: 'granulesK',
        granules_k: 'granulesK',
        executions_to_granule: 'executionsPerGranule',
        executions_per_granule: 'executionsPerGranule',
        files_per_gran: 'files',
      },
      default: {
        collections: 1,
        files: 1,
        granulesK: 10,
        executionsPerGranule: '2:2',
        variance: true,
        concurrency: 1,
      },
    }
  );
  const {
    granulesPerBatch,
    executionsPerBatch,
  } = parseExecutionsGranulesBatch(executionsPerGranule);
  return {
    granules: Number.parseInt(granulesK, 10) * 1000,
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
