'use strict';

/**
 * LocalStack has a bug where it ignores the `Tagging` parameter to the
 * `s3.createMultipartUpload` method. Since we are unable to verify that
 * MoveGranules preserves tags using LocalStack, we're going to have to test
 * it here instead.
 */

const get = require('lodash/get');
const pAll = require('p-all');
const querystring = require('querystring');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteS3Object, s3GetObjectTagging, s3PutObject } = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { moveGranules } = require('@cumulus/move-granules');
const { loadConfig } = require('../../helpers/testUtils');

describe('The MoveGranules task', () => {
  it('perserves object tags', async () => {
    let collection;
    let granuleId;
    let movedFile;
    let sourceKey;

    const config = await loadConfig();
    const prefix = config.stackName;
    const sourceBucket = config.bucket;

    process.env.stackName = config.stackName;
    process.env.system_bucket = config.buckets.internal.name;

    // The S3 path where granules will be ingested from
    const stagingDir = 'file-staging';

    try {
      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'error',
          process: 'modis',
        }
      );

      granuleId = randomId('granule-id-');

      // Stage the granule file to S3
      const stagedFilename = `${randomId('file-')}.txt`;
      sourceKey = `${stagingDir}/${stagedFilename}`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: sourceKey,
        Body: 'asdf',
        Tagging: querystring.stringify({ granuleId }),
      });

      const moveGranulesResponse = await moveGranules({
        config: {
          bucket: config.bucket,
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
                  path: stagingDir,
                  name: stagedFilename,
                },
              ],
            },
          ],
        },
      });

      // Verify that the tags of the moved granule match the tags of the source
      movedFile = moveGranulesResponse.granules[0].files[0];

      const movedFileTags = await s3GetObjectTagging(
        movedFile.bucket,
        movedFile.filepath
      );

      const expectedTagSet = [
        {
          Key: 'granuleId',
          Value: granuleId,
        },
      ];

      expect(movedFileTags.TagSet).toEqual(expectedTagSet);
    } finally {
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
    }
  });
});
