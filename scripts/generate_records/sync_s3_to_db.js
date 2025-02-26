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
  CollectionPgModel,
} = require('@cumulus/db');
const {
  loadCollection,
  loadExecutions,
  loadProvider,
  loadFiles,
  loadGranulesExecutions,
  loadGranules,
} = require('./db_record_loaders');
const { deconstructCollectionId } = require('@cumulus/message/Collections');

process.env.DISABLE_PG_SSL = 'true';

/**
 * parse command line args for run parameters
 *
 * @returns {{
*   collection: string
*   concurrency: number
* }}
*/
const parseArgs = () => {
  const {
    collection,
    concurrency,
  } = minimist(
    process.argv,
    {
      string: [
        'collection',
        'concurrency',
      ],
      default: {
        concurrency: process.env.CONCURRENCY || 1,
      },
    }
  );
  if (concurrency < 1) {
    throw new Error(`concurrency must be > 0, got ${concurrency}`);
  }
  return {
    collection: collection,
    concurrency: Number.parseInt(concurrency, 10),
  };
};

/**
* handle command line arguments and environment variables
* run the data upload based on configured parameters
*/
const main = async () => {
  const {
    collection,
    concurrency,
  } = parseArgs();
  console.log(concurrency)
  process.env.dbMaxPool = concurrency.toString();
  const knex = await getKnexClient();
  const collectionModel = new CollectionPgModel();
  const coll = await collectionModel.get(
    knex,
    deconstructCollectionId(
      collection
    )
  );
  console.log(coll)
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