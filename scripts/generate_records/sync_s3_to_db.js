// @ts-check
/* eslint-disable no-await-in-loop */
const pMap = require('p-map');
const fs = require('fs');
const path = require('path');
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
const { s3 } = require('../../packages/aws-client/services');
const { s3PutObject } = require('../../packages/aws-client/S3');
const { keyBy } = require('lodash');
const { BucketsConfig } = require('../../packages/common');

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
      console.log('putting up cmr', file, JSON.stringify(cmrString, null, 2));
      return s3PutObject({
        Key: file.key,
        Bucket: file.bucket,
        Body: cmrString,
      })
    } else {
      console.log('putting up regular file', file)
      return s3PutObject({
        Key: file.key,
        Bucket: file.bucket,
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
    await s3().createBucket({Bucket: 'cumulus-test-sandbox-public'})
  } catch {}
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
  let cursor = 10000;
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