// @ts-check
/* eslint-disable no-await-in-loop */
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const {
  FilePgModel,
  getKnexClient,
  CollectionPgModel,
} = require('@cumulus/db');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const { s3 } = require('../../packages/aws-client/services');
const { s3PutObject } = require('../../packages/aws-client/S3');

process.env.DISABLE_PG_SSL = 'true';
const cmrTemplate = fs.readFileSync(path.join(
  path.dirname(__filename),
  'data',
  'ummg-meta.cmr.json'
)).toString();
const putUpFiles = async (
  knex,
  granule,
  collection,
) => {
  const files = await knex('files').where({granule_cumulus_id: granule.cumulus_id})
  await Promise.all(files.map((file) => {
    if (file.key.endsWith('cmr.json')) {
      const cmrString = cmrTemplate
        .replace('replaceme-collectionname', collection.name)
        .replace('replaceme-collectionversion', collection.version);
      return s3PutObject({
        Key: file.key,
        Bucket: 'cumulus-test-sandbox-internal',
        Body: cmrString,
      })
    } else {
      return s3PutObject({
        Key: file.key,
        Bucket: 'cumulus-test-sandbox-internal',
        Body: 'a'
      })
    }
    
  }))
}

const getGranuleBatch = async (
  knex,
  collectionCumulusId,
  startAt,
  batchSize,
) => {
  return await knex('granules')
    .where({collection_cumulus_id: collectionCumulusId})
    .andWhere('cumulus_id', '>', startAt)
    .orderBy('cumulus_id')
    .limit(batchSize);
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
  try {
    await s3().createBucket({Bucket: 'cumulus-test-sandbox-internal'})
  } catch {}
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
    granules = await getGranuleBatch(
      knex,
      collection.cumulus_id,
      cursor, concurrency
    );
    await Promise.all(granules.map(async (granule) => putUpFiles(knex, granule, collection)));

    cursor = granules.length ? granules[granules.length-1].cumulus_id : 0
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