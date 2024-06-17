// @ts-check
/* eslint-disable no-await-in-loop */
const pMap = require('p-map');
const minimist = require('minimist');
const cliProgress = require('cli-progress');

const { randomInt } = require('crypto');
const {
  GranulePgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  FilePgModel,
  getKnexClient,
} = require('@cumulus/db');
const {
  loadCollection,
  loadExecutions,
  loadProvider,
  loadFiles,
  loadGranulesExecutions,
  loadGranules,
} = require('./db_record_loaders');

/**
 * @typedef {import('@cumulus/db').PostgresFile} PostgresFile
 * @typedef {import('@cumulus/db').PostgresGranule} PostgresGranule
 * @typedef {import('@cumulus/db').PostgresCollection} PostgresCollection
 * @typedef {import('knex').Knex} Knex
 * @typedef {{
 *   geModel: GranulesExecutionsPgModel,
 *   executionModel: ExecutionPgModel,
 *   granuleModel: GranulePgModel,
 *   fileModel: FilePgModel
 * }} ModelSet
 * @typedef {{
 *   name: string,
 *   version: string,
 * }} CollectionDetails
 */

process.env.DISABLE_PG_SSL = 'true';

/**
 * upload a batch of granules and executions
 * along with files per granule and granuleExecutions
 *
 * @typedef {{
 *   knex: Knex,
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
 * @returns {Promise<{
 *   granuleCumulusIds: Array<number>
 *   fileCumulusIds: Array<number>
 *   executionCumulusIds: Array<number>
 * }>}
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
  const granuleCumulusIds = await loadGranules(
    knex,
    collectionCumulusId,
    providerCumulusId,
    granulesPerBatch,
    models.granuleModel,
    swallowErrors
  );
  const fileCumulusIds = [];
  for (const granuleCumulusId of granuleCumulusIds) {
    fileCumulusIds.push(
      await loadFiles(knex, granuleCumulusId, filesPerGranule, models.fileModel, swallowErrors)
    );
  }
  const executionCumulusIds = await loadExecutions(
    knex,
    collectionCumulusId,
    executionsPerBatch,
    models.executionModel,
    swallowErrors
  );
  await loadGranulesExecutions(
    knex,
    granuleCumulusIds,
    executionCumulusIds,
    models.geModel,
    swallowErrors
  );
  return {
    granuleCumulusIds,
    fileCumulusIds: fileCumulusIds.flat(),
    executionCumulusIds,
  };
};

/**
 * create a generator Object that pretends to be an Iterable
 * this is to allow pmap to use this data without holding the entire (potentially very large)
 * set of batch params for more than the currently running threads
 *
 * @param {object} params
 * @param {Knex} params.knex
 * @param {number} params.numberOfGranules
 * @param {number} params.collectionCumulusId
 * @param {number} params.providerCumulusId
 * @param {number} params.filesPerGranule
 * @param {number} params.granulesPerBatch
 * @param {number} params.executionsPerBatch
 * @param {ModelSet} params.models
 * @param {boolean} params.variance
 * @param {boolean} params.swallowErrors
 * @returns {Iterable<BatchParams>}
 */

const getBatchParamGenerator = ({
  knex,
  numberOfGranules,
  collectionCumulusId,
  providerCumulusId,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  models,
  variance,
  swallowErrors = false,
}) => {
  if (granulesPerBatch < 1) {
    throw new Error('granulesPerBatch must be set to >=1');
  }
  /**
   * @yields {BatchParams}
   */
  function* batchParamGenerator() {
    const bar = new cliProgress.SingleBar(
      { etaBuffer: numberOfGranules / 10 }
    );
    bar.start(numberOfGranules, 0);

    const standardParams = {
      knex,
      collectionCumulusId,
      providerCumulusId,
      filesPerGranule,
      granulesPerBatch,
      executionsPerBatch,
      models,
      swallowErrors,
    };

    //asking for variance adds some noise to batch executions vs granules
    let _granulesPerBatch = granulesPerBatch;
    let _executionsPerBatch;
    for (let i = 0; i < numberOfGranules; i += _granulesPerBatch) {
      bar.update(i);
      if (variance) {
        _granulesPerBatch = granulesPerBatch + randomInt(6);
        _executionsPerBatch = executionsPerBatch + randomInt(6);
      }
      // this passes out an object each time pMap (or another iteration) asks for the next index
      // without holding onto it in memory
      yield {
        ...standardParams,
        granulesPerBatch: _granulesPerBatch,
        executionsPerBatch: _executionsPerBatch,
      };
    }

    bar.stop();
  }
  const clujedIterable = {};
  // this sets this objects iteration behavior to be batchParamGenerator
  clujedIterable[Symbol.iterator] = batchParamGenerator;

  return /** @type {Iterable<BatchParams>} */(clujedIterable);
};

/**
 * upload a batch of granules and executions
 * along with files per granule and granuleExecutions
 *
 * @param {Knex} knex
 * @param {number} collectionNumber
 * @param {number} numberOfGranules
 * @param {number} filesPerGranule
 * @param {number} granulesPerBatch
 * @param {number} executionsPerBatch
 * @param {number} concurrency
 * @param {boolean} variance
 * @param {boolean} swallowErrors
 * @returns {Promise<void>}
 */

const uploadDBGranules = async (
  knex,
  collectionNumber,
  numberOfGranules,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  concurrency,
  variance = false,
  swallowErrors = false
) => {
  const collectionCumulusId = await loadCollection(knex, filesPerGranule, collectionNumber);
  const providerCumulusId = await loadProvider(knex);

  const models = {
    geModel: new GranulesExecutionsPgModel(),
    executionModel: new ExecutionPgModel(),
    granuleModel: new GranulePgModel(),
    fileModel: new FilePgModel(),
  };
  const iterableParamGenerator = getBatchParamGenerator({
    knex,
    numberOfGranules,
    collectionCumulusId,
    providerCumulusId,
    filesPerGranule,
    granulesPerBatch,
    executionsPerBatch,
    models,
    variance,
    swallowErrors,
  });
  await pMap(
    iterableParamGenerator,
    // this lambda function swallows uploadDataBatch's return to prevent ballooning memory use
    async (params) => {
      await uploadDataBatch(params);
    },
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
 *   swallowErrors: boolean
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
    swallowErrors,
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
        'swallowErrors',
        'variance',
      ],
      alias: {
        g: 'granulesK',
        f: 'files',
        c: 'collections',
        e: 'executionsPerGranule',
        C: 'concurrency',
        v: 'variance',
        s: 'swallowErrors',
      },
      default: {
        collections: process.env.COLLECTIONS || 1,
        files: process.env.FILES || 1,
        granulesK: process.env.GRANULES_K || 10,
        executionsPerGranule: process.env.EXECUTIONS_PER_GRANULE || '2:2',
        variance: process.env.VARIANCE || false,
        concurrency: process.env.CONCURRENCY || 1,
        swallowErrors: process.env.SWALLOW_ERRORS || true,
      },
    }
  );
  const {
    granulesPerBatch,
    executionsPerBatch,
  } = parseExecutionsGranulesBatch(executionsPerGranule);
  if (granulesPerBatch < 1) {
    throw new Error(`granules per batch must be > 0, got ${granulesPerBatch} from ${executionsPerGranule}`);
  }
  if (concurrency < 1) {
    throw new Error(`concurrency must be > 0, got ${concurrency}`);
  }
  return {
    granules: Number.parseInt(granulesK, 10) * 1000,
    files: Number.parseInt(files, 10),
    granulesPerBatch: granulesPerBatch,
    executionsPerBatch: executionsPerBatch,
    collections: Number.parseInt(collections, 10),
    concurrency: Number.parseInt(concurrency, 10),
    variance,
    swallowErrors,
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
    swallowErrors,
  } = parseArgs();
  process.env.dbMaxPool = concurrency.toString();
  const knex = await getKnexClient();
  for (let collectionNumber = 0; collectionNumber < collections; collectionNumber += 1) {
    await uploadDBGranules(
      knex,
      collectionNumber,
      granules,
      files,
      granulesPerBatch,
      executionsPerBatch,
      concurrency,
      variance,
      swallowErrors
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
  getBatchParamGenerator,
  parseArgs,
  uploadDataBatch,
  uploadDBGranules,
};
