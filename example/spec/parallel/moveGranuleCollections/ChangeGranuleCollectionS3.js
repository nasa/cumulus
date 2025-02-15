'use strict';

const parseurl = require('parseurl');
const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const fs = require('fs');
const pick = require('lodash/pick');

const {
  deleteS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');

const { waitForListObjectsV2ResultCount, addCollections, addProviders, generateCmrFilesForGranules } = require('@cumulus/integration-tests');

const {
  createGranule,
  getGranule,
  deleteGranule,
  removePublishedGranule,
} = require('@cumulus/api-client/granules');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const { loadConfig, createTimestampedTestId, createTestSuffix, uploadTestDataToBucket } = require('../../helpers/testUtils');

describe('when ChangeGranuleCollectionS3 is called', () => {
  let testSetupFailed;
  let stackName;
  let config;
  let inputPayload;
  let granuleId;
  let startingFiles;
  let finalFiles;
  let collection;
  let targetCollection;
  let cleanupCollectionId;
  afterAll(async () => {
    try {
      await removePublishedGranule({
        prefix: config.stackName,
        granuleId,
        collectionId: cleanupCollectionId,
      });
      let cleanup = finalFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      ));
      cleanup.concat(startingFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      )));
      cleanup = cleanup.concat([
        deleteGranule({ prefix: config.stackName, granuleId: granuleId }),
      ]);

      await Promise.all(cleanup);
    } catch (error) {
      console.log('cleanup failed with error', error);
    }
  });
  beforeAll(async () => {
    try {
      const inputPayloadFilename = './data/payloads/IngestGranule.input.payload.json';
      const providersDir = './data/providers/s3/';
      const s3data = [
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104607.hdf.met',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104607.hdf',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104607_ndvi.jpg',
      ];

      const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
      const targetCollectionsDir = './data/collections/s3_MOD09GQ_007_full_ingest_move';
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      config = await loadConfig();
      stackName = config.stackName;
      const testId = createTimestampedTestId(stackName, 'IngestGranuleSuccess');
      const testSuffix = createTestSuffix(testId);

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      targetCollection = { name: `MOD09GQ${testSuffix}`, version: '007' };
      const sourceGranulePath = `${stackName}/${testSuffix}/${testId}/`;

      // populate collections, providers and test data
      await Promise.all([
        // Instead of uploading data to a bucket and triggering a workflow, let's just put the object in S3
        // and then call the API directly to write the granule record to the database
        uploadTestDataToBucket(config.bucket, s3data, sourceGranulePath),
        addCollections(stackName, config.bucket, collectionsDir, testSuffix, testId),
        addCollections(stackName, config.bucket, targetCollectionsDir, testSuffix, testId),
        addProviders(stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        JSON.stringify({ ...JSON.parse(inputPayloadJson), pdr: undefined }),
        granuleRegex,
        testSuffix,
        sourceGranulePath
      );
      granuleId = inputPayload.granules[0].granuleId;

      // Write granule to DB via API
      const granuleObject = {
        prefix: stackName,
        body: {
          ...(pick(inputPayload.granules[0], ['granuleId', 'files'])),
          collectionId: constructCollectionId(inputPayload.granules[0].dataType, inputPayload.granules[0].version),
          status: 'completed',
        },
      };
      granuleObject.body.files = granuleObject.body.files.map((file) => ({
        ...pick(file, ['size']),
        key: `${file.path}/${file.name}`,
        bucket: config.bucket,
      }));

      // Upload/add CMR file to granule
      const cmrFiles = await generateCmrFilesForGranules({
        granules: [granuleObject.body],
        collection,
        bucket: config.bucket,
        cmrMetadataFormat: 'echo',
        stagingDir: inputPayload.granules[0].files[0].path,
      });

      const { host: cmrBucket, path: cmrKey } = parseurl({ url: cmrFiles[3] });
      granuleObject.body.files.push({
        bucket: cmrBucket,
        key: cmrKey.slice(1),
      });

      await createGranule({ prefix: config.stackName,
        body: granuleObject.body });
    } catch (error) {
      console.log('setup test failed with', error);
      testSetupFailed = true;
    }
  });

  describe('The lambda, when invoked with an expected payload', () => {
    let beforeAllFailed = false;
    beforeAll(async () => {
      if (testSetupFailed) fail('test setup failed');
      startingFiles = (await getGranule({
        prefix: stackName,
        granuleId: granuleId,
      })).files;
      //upload to cumulus
      try {
        const { $metadata, Payload } = await lambda().send(new InvokeCommand({
          FunctionName: `${stackName}-ChangeGranuleCollectionS3`,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            cma: {
              meta: {
                targetCollection,
                collection,
                buckets: config.buckets,
              },
              task_config: {
                buckets: '{$.meta.buckets}',
                collection: '{$.meta.collection}',
                targetCollection: '{$.meta.targetCollection}',
              },
              event: {
                payload: { granuleIds: [granuleId] },
              },
            },
          }),
        }));
        const outputGranule = JSON.parse(new TextDecoder('utf-8').decode(Payload)).payload.granules[0];
        if ($metadata.httpStatusCode >= 400) {
          console.log(`lambda invocation to set up failed, code ${$metadata.httpStatusCode}`);
        }
        finalFiles = outputGranule.files;
        await Promise.all(finalFiles.map((file) => expectAsync(
          waitForListObjectsV2ResultCount({
            bucket: file.bucket,
            prefix: file.key,
            desiredCount: 1,
            interval: 5 * 1000,
            timeout: 60 * 1000,
          })
        ).toBeResolved()));
      } catch (error) {
        console.log(`files do not appear to have been moved: error: ${error}`);
        beforeAllFailed = true;
      }
    });
    it('updates the granule data in s3', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
      if (testSetupFailed) fail('testSetupFailed');
      await Promise.all(finalFiles.map(async (file) => {
        expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
      }));
    });
    it('keeps old s3 files as well', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
      if (testSetupFailed) fail('testSetupFailed');
      await Promise.all(startingFiles.map(async (file) => {
        expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
      }));
    });
  });
});
