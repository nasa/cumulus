// @ts-check
/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-await-in-loop */
const pMap = require('p-map');
const minimist = require('minimist');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs-extra');
const Logger = require('@cumulus/logger');
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
  translateApiProviderToPostgresProvider,
} = require('@cumulus/db');
const { randomInt } = require('crypto');
const { translateApiCollectionToPostgresCollection } = require('@cumulus/db');

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
 * add collection collectionPgModel call
 *
 * @param {any} knex
 * @param {string} collectionSuffix - append to collection name for uniqueness
 * @param {number} files - number of files per granule
 * @returns {Promise<void>}
 */
const addCollection = async (knex, collectionSuffix, files) => {
  const collectionJson = JSON.parse(fs.readFileSync(`${__dirname}/resources/collections/s3_MOD09GQ_006.json`, 'utf8'));
  collectionJson.name = `${collectionJson.name}_${collectionSuffix}`;
  collectionJson.files = (new Array(files)).map((i) => ({
    bucket: `${i}`,
    regex: `^.*${i}$`,
    sampleFileName: `538.${i}`,
  }));
  const collectionModel = new CollectionPgModel();
  await collectionModel.upsert(
    knex,
    translateApiCollectionToPostgresCollection(collectionJson)
  );
};

/**
 * add provider through providerPgModel call
 *
 * @param {object} knex
 * @returns {Promise<string>}
 */
const addProvider = async (knex) => {
  const providerJson = JSON.parse(fs.readFileSync(`${__dirname}/resources/s3_provider.json`, 'utf8'));
  const providerModel = new ProviderPgModel();
  const a = await providerModel.upsert(
    knex,
    await translateApiProviderToPostgresProvider(providerJson)
  );
  console.log(a);
  const [{ name: providerId }] = a;
  return providerId;
};
/**
 * upload files corresponding to granule with granuleCumulusId
 *
 * @param {object} knex
 * @param {number} granuleCumulusId
 * @param {string} granuleGranuleId
 * @param {number} fileCount
 * @param {ModelSet} models - set of PGmodels including fileModel
 * @param {boolean} swallowErrors
 * @returns {Promise<number>}
 */
const uploadFiles = async (
  knex,
  granuleCumulusId,
  granuleGranuleId,
  fileCount,
  models,
  swallowErrors = false
) => {
  const fileModel = models.fileModel;
  let uploaded = 0;
  for (let i = 0; i < fileCount; i += 1) {
    const file = /** @type {PostgresFile} */(fakeFileRecordFactory({
      bucket: `${i}`,
      key: `${granuleGranuleId}${i}`,
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
      await uploadFiles(
        knex,
        granuleOutput.cumulus_id,
        granuleOutput.granule_id,
        filesPerGranule,
        models,
        swallowErrors
      );
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
 * @param {object} params
 * @param {object} params.knex
 * @param {number} params.granules
 * @param {number} params.collectionCumulusId
 * @param {number} params.providerCumulusId
 * @param {number} params.filesPerGranule
 * @param {number} params.granulesPerBatch
 * @param {number} params.executionsPerBatch
 * @param {ModelSet} params.models
 * @param {boolean} params.variance
 * @returns {Iterable<BatchParams>}
 */

const getDetailGenerator = ({
  knex,
  granules,
  collectionCumulusId,
  providerCumulusId,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  models,
  variance,
}) => {
  if (granulesPerBatch < 1) {
    throw new Error('granulesPerBatch must be set to >=1');
  }
  function* detailGenerator() {
    let _granulesPerBatch = 1;
    for (let i = 0; i < granules; i += _granulesPerBatch) {
      console.log(i);
      _granulesPerBatch = granulesPerBatch + (variance ? randomInt(6) : 0);
      const _executionsPerBatch = executionsPerBatch + (variance ? randomInt(6) : 0);
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
  knex,
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
  const iterableDetailGenerator = getDetailGenerator({
    knex,
    granules,
    collectionCumulusId,
    providerCumulusId,
    filesPerGranule,
    granulesPerBatch,
    executionsPerBatch,
    models,
    variance,
  });
  await pMap(
    iterableDetailGenerator,
    uploadDataBatch,
    { concurrency }
  );
};

/**
 * Parse executions per batch and granules per batch based on a given ratio
 *
 * @param {string} executionsPerGranule - executionsPerGranule in <executions>:<granules>
 * @returns {{executionsPerBatch: number, granulesPerBatch: number}}
 */
const parseExecutionsGranulesBatch = (executionsPerGranule) => {
  // expect to come in format 'x:y'
  try {
    const split = executionsPerGranule.split(':');
    if (split.length < 2) {
      throw new Error(`only 1 value could be split from ${executionsPerGranule}`);
    }
    const executionsPerBatch = Number.parseInt(split[0], 10);
    const granulesPerBatch = Number.parseInt(split[1], 10);
    return { executionsPerBatch, granulesPerBatch };
  } catch (error) {
    throw new Error(`cannot parse ${executionsPerGranule}, expected format <executions>:<granules> ratio \n${error}`);
  }
};

/**
 * parse command line args for run parameters
 *
 * @returns {{
 *   granules: number,
 *   files: number,
 *   granulesPerBatch: number
 *   executionsPerBatch: number
 *   collections: number
 *   concurrency: number
 *   variance: boolean
 * }}
 */
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
        executions_to_granules: 'executionsPerGranule',
        executions_per_granule: 'executionsPerGranule',
        files_per_gran: 'files',
      },
      default: {
        collections: process.env.COLLECTIONS || 1,
        files: process.env.FILES || 1,
        granulesK: process.env.GRANULES_K || 10,
        executionsPerGranule: process.env.EXECUTIONS_PER_GRANULE || '2:2',
        variance: process.env.VARIANCE || false,
        concurrency: process.env.CONCURRENCY || 1,
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

/**
 * handle command line arguments and environment variables
 * run the data upload based on configured parameters
 */
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
  const knex = await getKnexClient();
  const providerId = await addProvider(knex);
  for (const collection of yieldCollectionDetails(collections, true)) {
    await addCollection(knex, collection.suffix, files);
    await uploadDBGranules(
      knex,
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
  parseArgs,
  uploadDBGranules,
};
