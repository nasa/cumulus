//@ts-check

const cliProgress = require('cli-progress');
const {
  loadExecutions,
  loadCollection,
} = require('./db_record_loaders');
const { ExecutionPgModel, getKnexClient } = require('@cumulus/db');
const pMap = require('p-map');
const { randomInt } = require('crypto');
const moment = require('moment');

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
 * 
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
      original_payload: Math.random() < 0.2 ? {'a': 'b'} : null,
      final_payload: Math.random() < 0.2 ? {'a': 'b'} : null
    }
  )
}
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

const main = async () => {
  const knex = await getKnexClient();
  console.log(knex);
  const collectionCumulusId = await loadCollection(knex, 0, 0);
  console.log('loaded collection', collectionCumulusId)
  const model = new ExecutionPgModel();

  process.env.dbMaxPool = '1000';
  const iterableParamGenerator = getBatchParamGenerator({
    knex,
    collectionCumulusId,
    numberOfExecutions: 500000,
    executionsPerBatch: 100,
    model
  })
  await pMap(
    iterableParamGenerator,
    async (params) => {
      await uploadExecutionsBatch(params)
    },
    { concurrency: 100, stopOnError: false }
  )
}


if (require.main === module) {
  main(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}
