'use strict';

const path = require('path');
const { addProviders, addCollections } = require('@cumulus/integration-tests');
const { s3 } = require('@cumulus/common/aws');
const { loadConfig } = require('../helpers/testUtils');
const fs = require('fs-extra');
const config = loadConfig();

const collectionsDirectory = './data/collections';
const providersDirectory = './data/providers';

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3.PDR',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg'
];

/**
 * Upload a file from the test-data package to the S3 test data
 *
 * @param {string} file - filename of data to upload
 * @param {string} bucket - bucket to upload to
 * @returns {Promise<Object>} - promise returned from S3 PUT
 */
function uploadTestDataToS3(file, bucket) {
  const data = fs.readFileSync(require.resolve(file), 'utf8');
  const key = path.basename(file);

  return s3().putObject({
    Bucket: bucket,
    Key: `cumulus-test-data/pdrs/${key}`,
    Body: data
  }).promise();
}

/**
 * For the given bucket, upload all the test data files to S3
 *
 * @param {string} bucket - S3 bucket
 * @returns {Array<Promise>} - responses from S3 upload
 */
function uploadTestDataToBucket(bucket) {
  return Promise.all(s3data.map((file) => uploadTestDataToS3(file, bucket)));
}

describe('Populating providers and collections to database', () => {
  let collections;
  let providers;
  beforeAll(async () => {
    try {
      collections = await addCollections(config.stackName, config.bucket, collectionsDirectory);
      providers = await addProviders(config.stackName, config.bucket, providersDirectory, config.bucket);

      console.log(`Uploading test data to S3 bucket: ${config.bucket}`);
      await uploadTestDataToBucket(config.bucket);
    }
    catch (e) {
      console.log(e);
      throw e;
    }
  });

  it('providers and collections are added successfully', async () => {
    expect(collections >= 1).toBe(true);
    expect(providers >= 1).toBe(true);
  });
});
