//@ts-check
/* eslint-disable no-await-in-loop */
/* eslint-disable node/no-extraneous-require */
const cliProgress = require('cli-progress');
const { ExecutionPgModel, getKnexClient } = require('@cumulus/db');
const pMap = require('p-map');
const { randomInt } = require('crypto');
const minimist = require('minimist');
const moment = require('moment');
const range = require('lodash/range');
const {
  loadExecutions,
  loadCollection,
} = require('./db_record_loaders');
process.env.DISABLE_PG_SSL = 'true';
/**
 *
 * @typedef {import('knex').Knex} Knex
 * @typedef {{
 *   knex: Knex,
 *   collectionCumulusId: number,
 *   executionsPerBatch: number,
 *   model: ExecutionPgModel,
 * }} BatchParams
 */

/**
 *
 * @param {BatchParams} params
 * @returns {Promise<void>}
 */
const uploadExecutionsBatch = async (
  {
    knex,
    collectionCumulusId,
    executionsPerBatch,
    model,
  }
) => {
  await loadExecutions(
    knex,
    collectionCumulusId,
    executionsPerBatch,
    model,
    {
      updated_at: moment().subtract(randomInt(20), 'days').toDate(),
      original_payload: Math.random() < 0.4 ? { a: 'b' } : null,
      final_payload: Math.random() < 0.4 ? { a: 'b' } : null,
    }
  );
};

/**
 * create a generator Object that pretends to be an Iterable
 * this is to allow pmap to use this data without holding the entire (potentially very large)
 * set of batch params for more than the currently running threads
 *
 * @param {object} params
 * @param {Knex} params.knex
 * @param {number} params.collectionCumulusId
 * @param {number} params.numberOfExecutions
 * @param {number} params.executionsPerBatch
 * @param {ExecutionPgModel} params.model
 * @returns {Iterable<BatchParams>}
 */
const getBatchParamGenerator = ({
  knex,
  collectionCumulusId,
  numberOfExecutions,
  executionsPerBatch,
  model,
}) => {
  if (numberOfExecutions < 1) {
    throw new Error('numberOfExecutions must be set to >=1');
  }
  /**
   * @yields {BatchParams}
   */
  function* batchParamGenerator() {
    const bar = new cliProgress.SingleBar(
      { etaBuffer: numberOfExecutions / 10 }
    );
    bar.start(numberOfExecutions, 0);

    const standardParams = {
      knex,
      collectionCumulusId,
      executionsPerBatch,
      model,
    };

    //asking for variance adds some noise to batch executions vs granules
    for (let i = 0; i < numberOfExecutions; i += executionsPerBatch) {
      bar.update(i);
      // this passes out an object each time pMap (or another iteration) asks for the next index
      // without holding onto it in memory
      yield {
        ...standardParams,
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
 * parse command line args for run parameters
 *
 * @returns {{
*   executions: number
*   executionsPerBatch: number
*   collections: number
*   concurrency: number
*   swallowErrors: boolean
* }}
*/
const parseArgs = () => {
  const {
    collections,
    executionsK,
    concurrency,
    swallowErrors,
  } = minimist(
    process.argv,
    {
      string: [
        'collections',
        'executionsK',
        'concurrency',
      ],
      boolean: [
        'swallowErrors',
      ],
      alias: {
        e: 'executionsK',
        c: 'collections',
        C: 'concurrency',
        s: 'swallowErrors',
      },
      default: {
        collections: process.env.COLLECTIONS || 1,
        executionsK: process.env.EXECUTIONS || 10,
        concurrency: process.env.CONCURRENCY || 1,
        swallowErrors: process.env.SWALLOW_ERRORS || true,
      },
    }
  );

  if (executionsK < 1) {
    throw new Error(`executionsK must be > 0, got ${executionsK}`);
  }
  if (collections < 1) {
    throw new Error(`collections must be > 0, got ${collections}`);
  }
  if (concurrency < 1) {
    throw new Error(`collections must be > 0, got ${concurrency}`);
  }
  const executions = Number.parseInt(executionsK, 10) * 1000;
  const executionsPerBatch = Math.min(50, executions / concurrency);
  return {
    executionsPerBatch,
    executions,
    collections: Number.parseInt(collections, 10),
    concurrency: Number.parseInt(concurrency, 10),
    swallowErrors,
  };
};

const main = async () => {
  const {
    executionsPerBatch,
    executions,
    collections,
    concurrency,
    swallowErrors,
  } = parseArgs();
  process.env.dbMaxPool = String(concurrency);
  const knex = await getKnexClient();
  for (const i of range(collections)) {
    const collectionCumulusId = await loadCollection(knex, 0, i);
    const model = new ExecutionPgModel();

    const iterableParamGenerator = getBatchParamGenerator({
      knex,
      collectionCumulusId,
      numberOfExecutions: executions,
      executionsPerBatch: executionsPerBatch,
      model,
    });
    await pMap(
      iterableParamGenerator,
      async (params) => {
        await uploadExecutionsBatch(params);
      },
      { concurrency: concurrency, stopOnError: !swallowErrors }
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
  main,
};

