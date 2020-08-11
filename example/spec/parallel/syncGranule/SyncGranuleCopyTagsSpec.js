'use strict';

/**
 * LocalStack has a bug where it ignores the `Tagging` parameter to the
 * `s3.createMultipartUpload` method. Since we are unable to verify that
 * SyncGranule preserves tags using LocalStack, we're going to have to test
 * it here instead.
 */

const get = require('lodash/get');
const pAll = require('p-all');
const querystring = require('querystring');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteS3Object, s3GetObjectTagging, s3PutObject } = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const { syncGranule } = require('@cumulus/sync-granule');
const { loadConfig } = require('../../helpers/testUtils');

describe('The SyncGranule task', () => {
  it('copies tags from the source files to the destination', async () => {
    let collection;
    let granuleId;
    let provider;
    let sourceKey;

    const config = await loadConfig();
    const prefix = config.stackName;
    const sourceBucket = config.bucket;

    // The S3 path where granules will be ingested from
    const sourcePath = `${prefix}/tmp/${randomId('test-')}`;

    try {
      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'error',
          process: 'modis',
        }
      );

      // Create the S3 provider
      provider = await createProvider(prefix, { host: sourceBucket });

      granuleId = randomId('granule-id-');

      // Stage the granule file to S3
      const sourceFilename = `${randomId('file-')}.txt`;
      sourceKey = `${sourcePath}/${sourceFilename}`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: sourceKey,
        Body: 'asdf',
        Tagging: querystring.stringify({ granuleId }),
      });

      // Call syncGranule
      const syncGranuleResponse = await syncGranule({
        config: {
          stack: config.stackName,
          buckets: config.buckets,
          provider,
          collection,
          downloadBucket: config.bucket,
        },
        input: {
          granules: [
            {
              granuleId,
              dataType: collection.name,
              version: collection.version,
              files: [
                {
                  path: sourcePath,
                  name: sourceFilename,
                },
              ],
            },
          ],
        },
      });

      // Verify that the tags of the synced granule match the tags of the source
      const stagedFile = syncGranuleResponse.granules[0].files[0];

      const stagedFileTags = await s3GetObjectTagging(
        stagedFile.bucket,
        `${stagedFile.fileStagingDir}/${stagedFile.name}`
      );

      const expectedTagSet = [
        {
          Key: 'granuleId',
          Value: granuleId,
        },
      ];

      expect(stagedFileTags.TagSet).toEqual(expectedTagSet);
    } finally {
      await pAll(
        [
          () => deleteS3Object(sourceBucket, sourceKey),
          () => deleteGranule({ prefix, granuleId }),
          () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
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
