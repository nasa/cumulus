// @ts-check
/* eslint-disable no-await-in-loop */
const minimist = require('minimist');
const { bulkPatch, getGranule, updateGranule } = require('@cumulus/api-client/granules');
const { randomInt } = require('crypto');
const {
  GranulePgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  FilePgModel,
  getKnexClient,
  CollectionPgModel,
} = require('@cumulus/db');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const { clone } = require('lodash');
process.env.DISABLE_PG_SSL = 'true';

const getGranuleBatch = async (
  knex,
  collectionCumulusId,
  startAt,
  batchSize,
) => {
  console.log(collectionCumulusId, startAt, batchSize)
  const pgGranules =  await knex('granules')
    .where({collection_cumulus_id: collectionCumulusId})
    .andWhere('cumulus_id', '>', startAt)
    .orderBy('cumulus_id')
    .limit(batchSize)
  const cursor = pgGranules.length ? pgGranules[pgGranules.length-1].cumulus_id : 0
  console.log('returning cursor', cursor, pgGranules)
  return {
    granules: await Promise.all(pgGranules.map((granule) => getGranule({prefix: 'ecarton-ci-tf', granuleId: granule.granule_id}))),
    cursor
  }
}

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
    collection: collectionId,
    concurrency,
  } = parseArgs();
  console.log(concurrency)
  process.env.dbMaxPool = concurrency.toString();
  const knex = await getKnexClient();
  const collectionModel = new CollectionPgModel();
  const fileModel = new FilePgModel();
  const collection = await collectionModel.get(
    knex,
    deconstructCollectionId(
      collectionId
    )
  );
  let cursor = 0;
  let granules = []
  do {
    const granuleBatch = await getGranuleBatch(
      knex,
      collection.cumulus_id,
      cursor, concurrency
    );
    granules = granuleBatch.granules;
    cursor = granuleBatch.cursor;
    const updatedGranules = granules.map((g) => {
        return {
          ...g,
          files: g.files.concat({key: 'a', bucket: 'b'})
        }
      }
    )
    // for (const g of updatedGranules) {
    await Promise.all(updatedGranules.map((g) => updateGranule({
          prefix: 'ecarton-ci-tf',
          body: g,
          granuleId: g.granuleId
        })
    ))
    // await bulkPatch({
    //   prefix: 'ecarton-ci-tf',
    //   body: {
    //     apiGranules: updatedGranules,
    //     dbConcurrency: concurrency,
    //     dbMaxPool: concurrency*3
    //   }
    // })
  } while (granules.length);


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