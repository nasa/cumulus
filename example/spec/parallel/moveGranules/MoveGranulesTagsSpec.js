'use strict';

// TODO: rename this file to be clear it is also testing moving zero byte files

/**
 * LocalStack has a bug where it ignores the `Tagging` parameter to the
 * `s3.createMultipartUpload` method. Since we are unable to verify that
 * MoveGranules preserves tags using LocalStack, we're going to have to test
 * it here instead.
 * Also, Localstack does not behave the same as S3 when trying to move 0 byte files with
 * multipartCopyObject. Since we are unable to accurately test moving a 0 byte file with Localstack,
 * we are testing it here.
 */

const get = require('lodash/get');
const pAll = require('p-all');
const querystring = require('querystring');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteS3Object, s3GetObjectTagging, s3PutObject } = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { moveGranules } = require('@cumulus/move-granules');
const { headObject, s3ObjectExists } = require('@cumulus/aws-client/S3');
const { loadConfig } = require('../../helpers/testUtils');

describe('The MoveGranules task', () => {
  let beforeAllFailed = false;
  let collection;
  let config;
  let granuleId;
  let movedFile;
  let moveGranulesResponse;
  let prefix;
  let sourceBucket;
  let sourceKey;

  // const zeroByteFilename = '0byte.dat';
  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;
      sourceBucket = config.bucket;

      process.env.stackName = config.stackName;
      process.env.system_bucket = config.buckets.internal.name;

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'error',
          process: 'modis',
        }
      );

      granuleId = randomId('granule-id-');

      // Stage the granule file to S3 (zero byte file with tagging)
      const stagingDir = 'file-staging';
      const stagedZeroByteFilename = `${randomId('file-')}.dat`;
      sourceKey = `${stagingDir}/${stagedZeroByteFilename}`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: sourceKey,
        Body: '',
        Tagging: querystring.stringify({ granuleId }),
      });

      moveGranulesResponse = await moveGranules({
        config: {
          buckets: config.buckets,
          distribution_endpoint: 'http://www.example.com',
          collection,
        },
        input: {
          granules: [
            {
              files: [
                {
                  bucket: sourceBucket,
                  key: sourceKey,
                  fileName: stagedZeroByteFilename,
                  size: 0,
                },
              ],
            },
          ],
        },
      });

      movedFile = moveGranulesResponse.granules[0].files[0];
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    await pAll(
      [
        () => deleteS3Object(sourceBucket, sourceKey),
        () => deleteS3Object(movedFile.bucket, movedFile.filepath),
        () => deleteCollection({
          prefix,
          collectionName: get(collection, 'name'),
          collectionVersion: get(collection, 'version'),
        }),
      ],
      { stopOnError: false }
    ).catch(console.error);
  });

  it('succeeds moving the 0 byte file', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');

    const existCheck = await s3ObjectExists({ Bucket: movedFile.bucket, Key: movedFile.key });
    const object = await headObject(movedFile.bucket, movedFile.key);
    const objectSize = object.ContentLength;

    expect(existCheck).toEqual(true);
    expect(objectSize).toEqual(0);
  });

  it('preserves object tags', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');

    // Verify that the tags of the moved granule match the tags of the source
    const movedFileTags = await s3GetObjectTagging(
      movedFile.bucket,
      movedFile.key
    );

    const expectedTagSet = [
      {
        Key: 'granuleId',
        Value: granuleId,
      },
    ];

    expect(movedFileTags.TagSet).toEqual(expectedTagSet);
  });
});
