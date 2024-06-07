// @ts-check
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

/**
 * @typedef {import('@cumulus/db').PostgresFile} PostgresFile
 * @typedef {import('@cumulus/db').PostgresGranule} PostgresGranule
 * @typedef {{
 *   geModel: GranulesExecutionsPgModel,
 *   executionModel: ExecutionPgModel,
 *   granuleModel: GranulePgModel,
 *   fileModel: FilePgModel
 * }} ModelSet
 * @typedef {{
 *   name: string,
 *   version: string,
 *   suffix: string,
 * }} CollectionDetails
 */

process.env.DISABLE_PG_SSL = 'true';

const createTimestampedTestId = (stackName, testName) =>
  `${stackName}-${testName}-${Date.now()}`;

function* yieldCollectionDetails(total, repeatable = true) {
  for (let i = 0; i < total; i += 1) {
    let suffix;
    if (repeatable) {
      suffix = `_test_${i.toString().padStart(3, '0')}`;
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

/**
 * add collection through cumulus-api call
 *
 * @param {string} stackName
 * @param {string} bucket
 * @param {string} collectionSuffix - append to collection name for uniqueness
 * @returns {Promise<void>}
 */
const addCollection = async (stackName, bucket, collectionSuffix) => {
  const testId = createTimestampedTestId(stackName, 'IngestGranuleSuccess');
  try {
    await addCollections(
      stackName,
      bucket,
      `${__dirname}/resources/collections/`,
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

/**
 * add provider through cumulus-api call
 *
 * @param {string} stackName
 * @param {string} bucket
 * @returns {Promise<string>}
 */
const addProvider = async (stackName, bucket) => {
  const providerId = 's3_provider_test';
  const providerJson = JSON.parse(fs.readFileSync(`${__dirname}/resources/s3_provider.json`, 'utf8'));
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
/**
 * upload files corresponding to granule with granuleCumulusId
 *
 * @param {object} knex
 * @param {number} granuleCumulusId
 * @param {number} fileCount
 * @param {ModelSet} models - set of PGmodels including fileModel
 * @param {boolean} swallowErrors
 * @returns {Promise<number>}
 */
const uploadFiles = async (
  knex,
  granuleCumulusId,
  fileCount,
  models,
  swallowErrors = false
) => {
  const fileModel = models.fileModel;
  let uploaded = 0;
  for (let i = 0; i < fileCount; i += 1) {
    const file = /** @type {PostgresFile} */(fakeFileRecordFactory({
      granule_cumulus_id: granuleCumulusId,
    }));
    try {
      await fileModel.upsert(knex, file);
      uploaded += 1;
    } catch (error) {
      if (!swallowErrors) throw error;
      log.error(`failed up upload file: ${error}`);
    }
  }
  return uploaded;
};
/**
 * upload executions corresponding to collection with collectionCumulusId
 *
 * @param {object} knex
 * @param {number} collectionCumulusId
 * @param {number} executionCount
 * @param {ModelSet} models - set of PGmodels including executionModel
 * @param {boolean} swallowErrors
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded execution
 */
const uploadExecutions = async (
  knex,
  collectionCumulusId,
  executionCount,
  models,
  swallowErrors = false
) => {
  const executionCumulusIds = [];
  const executionModel = models.executionModel;
  for (let i = 0; i < executionCount; i += 1) {
    const execution = fakeExecutionRecordFactory({ collection_cumulus_id: collectionCumulusId });
    try {
      const [executionOutput] = await executionModel.upsert(knex, execution);
      executionCumulusIds.push(executionOutput.cumulus_id);
    } catch (error) {
      if (!swallowErrors) throw error;
      log.error(`failed up upload execution: ${error}`);
    }
  }
  return executionCumulusIds;
};

/**
 * upload granules corresponding to collection with collectionCumulusId
 *
 * @param {object} knex
 * @param {number} collectionCumulusId
 * @param {number} providerCumulusId
 * @param {number} granuleCount
 * @param {number} filesPerGranule
 * @param {ModelSet} models - set of PGmodels including granuleModel
 * @param {boolean} swallowErrors
 * @returns {Promise<Array<number>>} - cumulusId for each successfully uploaded granule
 */
const uploadGranules = async (
  knex,
  collectionCumulusId,
  providerCumulusId,
  granuleCount,
  filesPerGranule,
  models,
  swallowErrors = false
) => {
  const granuleCumulusIds = [];
  const granuleModel = models.granuleModel;
  for (let i = 0; i < granuleCount; i += 1) {
    const granule = /** @type {PostgresGranule} */(fakeGranuleRecordFactory({
      collection_cumulus_id: collectionCumulusId,
      provider_cumulus_id: providerCumulusId,
      status: 'completed',
    }));
    try {
      const [granuleOutput] = await granuleModel.upsert({
        knexOrTrx: knex,
        granule,
        writeConstraints: true,
      });
      granuleCumulusIds.push(granuleOutput.cumulus_id);
      await uploadFiles(knex, granuleOutput.cumulus_id, filesPerGranule, models, swallowErrors);
    } catch (error) {
      if (!swallowErrors) throw error;
      log.error(`failed up upload granule: ${error}`);
    }
  }
  return granuleCumulusIds;
};

/**
 * upload granuleExecutions corresponding to each pair
 * within list of granuleCumulusIds and executionCumulusIds
 *
 * @param {object} knex
 * @param {Array<number>} granuleCumulusIds
 * @param {Array<number>} executionCumulusIds
 * @param {ModelSet} models - set of PGmodels including geModel
 * @param {boolean} swallowErrors
 * @returns {Promise<number>} - number of granuleExecutions uploaded
 */
const uploadGranuleExecutions = async (
  knex,
  granuleCumulusIds,
  executionCumulusIds,
  models,
  swallowErrors = false
) => {
  const GEmodel = models.geModel;
  let uploaded = 0;
  for (let i = 0; i < granuleCumulusIds.length; i += 1) {
    for (let j = 0; j < executionCumulusIds.length; j += 1) {
      try {
        await GEmodel.upsert(
          knex,
          {
            granule_cumulus_id: granuleCumulusIds[i],
            execution_cumulus_id: executionCumulusIds[j],
          }
        );
        uploaded += 1;
      } catch (error) {
        if (!swallowErrors) throw error;
        log.error(`failed up upload granuleExecution: ${error}`);
      }
    }
  }
  return uploaded;
};

/**
 * upload a batch of granules and executions
 * along with files per granule and granuleExecutions
 *
 * @typedef {{
 *   knex: object,
 *   collectionCumulusId: number,
 *   providerCumulusId: number,
 *   filesPerGranule: number
 *   granulesPerBatch: number,
 *   executionsPerBatch: number,
 *   models: ModelSet,
 *   swallowErrors: boolean,
 * }} BatchParams
 *
 * @param {BatchParams} params
 * @returns {Promise<void>}
 */
const uploadDataBatch = async ({
  knex,
  collectionCumulusId,
  providerCumulusId,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  models,
  swallowErrors,
}) => {
  console.log('running batch with', {
    knex,
    collectionCumulusId,
    providerCumulusId,
    filesPerGranule,
    granulesPerBatch,
    executionsPerBatch,
    models,
    swallowErrors,
  });
  const granuleCumulusIds = await uploadGranules(
    knex,
    collectionCumulusId,
    providerCumulusId,
    granulesPerBatch,
    filesPerGranule,
    models,
    swallowErrors
  );
  const executionCumulusIds = await uploadExecutions(
    knex,
    collectionCumulusId,
    executionsPerBatch,
    models,
    swallowErrors
  );
  await uploadGranuleExecutions(
    knex,
    granuleCumulusIds,
    executionCumulusIds,
    models,
    swallowErrors
  );
};

/**
 * create a generator Object that pretends to be an Iterable
 * this is to allow pmap to use this data without holding the entire (potentially very large)
 * set of batch params for more than the currently running threads
 *
 * @param {object} knex
 * @param {number} granules
 * @param {number} collectionCumulusId
 * @param {number} providerCumulusId
 * @param {number} filesPerGranule
 * @param {number} granulesPerBatch
 * @param {number} executionsPerBatch
 * @param {ModelSet} models
 * @param {boolean} variance
 * @returns {Iterable<BatchParams>}
 */

const getDetailGenerator = (
  knex,
  granules,
  collectionCumulusId,
  providerCumulusId,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  models,
  variance
) => {
  console.log({
    knex,
    granules,
    collectionCumulusId,
    providerCumulusId,
    filesPerGranule,
    granulesPerBatch,
    executionsPerBatch,
    models,
    variance
  })
  function* detailGenerator() {
    let _granulesPerBatch = 1;
    for (let i = 0; i < granules; i += _granulesPerBatch) {
      console.log('in here', i);
      _granulesPerBatch = granulesPerBatch + (variance ? randomInt(6) : 0);
      const _executionsPerBatch = executionsPerBatch + (variance ? randomInt(5) : 0);
      yield {
        knex,
        collectionCumulusId,
        providerCumulusId,
        filesPerGranule,
        granulesPerBatch: _granulesPerBatch,
        executionsPerBatch: _executionsPerBatch,
        models,
        swallowErrors: true,
      };
    }
  }
  const detailGeneratorPretendingToBeIterable = {};
  detailGeneratorPretendingToBeIterable[Symbol.iterator] = detailGenerator;
  for (const a of detailGenerator()) {
    console.log(a)
  }
  return /** @type {Iterable<BatchParams>} */(detailGeneratorPretendingToBeIterable);
};

/**
 * upload a batch of granules and executions
 * along with files per granule and granuleExecutions
 *
 * @param {string} providerId
 * @param {CollectionDetails} collection
 * @param {number} granules
 * @param {number} filesPerGranule
 * @param {number} granulesPerBatch
 * @param {number} executionsPerBatch
 * @param {number} concurrency
 * @param {boolean} variance
 * @returns {Promise<void>}
 */

const uploadDBGranules = async (
  providerId,
  collection,
  granules,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  concurrency,
  variance
) => {
  process.env.dbMaxPool = concurrency.toString();
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
  const iterableDetailGenerator = getDetailGenerator(
    knex,
    granules,
    collectionCumulusId,
    providerCumulusId,
    filesPerGranule,
    granulesPerBatch,
    executionsPerBatch,
    models,
    variance
  );
  await pMap(
    iterableDetailGenerator,
    uploadDataBatch,
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
        variance: false,
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
    granulesPerBatch: granulesPerBatch,
    executionsPerBatch: executionsPerBatch,
    collections: Number.parseInt(collections, 10),
    concurrency: Number.parseInt(concurrency, 10),
    variance,
  };
};

const main = async () => {
  const {
    granules,
    files,
    granulesPerBatch,
    executionsPerBatch,
    collections,
    variance,
    concurrency,
  } = parseArgs();

  const stackName = getRequiredEnvVar('DEPLOYMENT');
  const internalBucket = getRequiredEnvVar('INTERNAL_BUCKET');
  const providerId = await addProvider(stackName, internalBucket);
  for (const collection of yieldCollectionDetails(collections, true)) {
    await addCollection(stackName, internalBucket, collection.suffix);
    await uploadDBGranules(
      providerId,
      collection,
      granules,
      files,
      granulesPerBatch,
      executionsPerBatch,
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

module.exports = {
  yieldCollectionDetails,
  addCollection,
  uploadExecutions,
  uploadGranules,
  uploadFiles,
  uploadGranuleExecutions,
  getDetailGenerator,
};
