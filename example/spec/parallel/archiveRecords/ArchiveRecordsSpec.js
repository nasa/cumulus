'use strict';

const parseurl = require('parseurl');
const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const fs = require('fs');
const pick = require('lodash/pick');
const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');

const { addCollections, addProviders, generateCmrFilesForGranules } = require('@cumulus/integration-tests');

const {
  createGranule,
  getGranule,
  deleteGranule,
} = require('@cumulus/api-client/granules');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  uploadTestDataToBucket,
  deleteFolder,
} = require('../../helpers/testUtils');

describe('when ChangeGranuleCollectionPG is called', () => {
  const monthEpoch = 2629743000;
  const yearEpoch = 31556926000;
  let testSetupFailed;
  let stackName;
  let config;
  let inputPayload;
  let granuleId;
  let collection;
  let sourceGranulePath;
  let granuleObject;

  afterAll(async () => {
    // Remove all the setup data - all keys at s3://${config.bucket}/sourceGranulePath
    let cleanup = [];
    cleanup.concat([
      Promise.all(granuleObject.body.files.map((file) => deleteS3Object(file.bucket, file.key))),
    ]);
    cleanup.concat([
      deleteFolder(config.bucket, sourceGranulePath),
    ]);
    cleanup = cleanup.concat([
      deleteGranule({ prefix: config.stackName, granuleId: granuleId }),
    ]);
    await Promise.all(cleanup);
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
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      config = await loadConfig();
      stackName = config.stackName;
      const testId = createTimestampedTestId(stackName, 'changeGranuleCollectionPg');
      const testSuffix = createTestSuffix(testId);

      collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
      sourceGranulePath = `${stackName}/${testSuffix}/${testId}`;

      // populate collections, providers and test data
      await Promise.all([
        // Instead of uploading data to a bucket and triggering a workflow, let's just put the object in S3
        // and then call the API directly to write the granule record to the database
        uploadTestDataToBucket(config.bucket, s3data, sourceGranulePath),
        addCollections(stackName, config.bucket, collectionsDir, testSuffix, testId),
        addProviders(stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        JSON.stringify({
          ...JSON.parse(inputPayloadJson),
          pdr: undefined,
        }),
        granuleRegex,
        testSuffix,
        sourceGranulePath
      );
      granuleId = inputPayload.granules[0].granuleId;

      // Write granule to DB via API
      granuleObject = {
        prefix: stackName,
        body: {
          ...(pick(inputPayload.granules[0], ['granuleId', 'files'])),
          collectionId: constructCollectionId(inputPayload.granules[0].dataType, inputPayload.granules[0].version),
          status: 'completed',
          updatedAt: Date.now() - yearEpoch - monthEpoch, // more than a year ago
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

      await createGranule({
        prefix: config.stackName,
        body: granuleObject.body,
      });
    } catch (error) {
      console.log('setup test failed with', error);
      testSetupFailed = true;
    }
  });

  describe('The lambda, when invoked with an expected payload', () => {
    it('does not archive records younger than expirationDays', async () => {
      if (testSetupFailed) fail('test setup failed');
      const { $metadata } = await lambda().send(new InvokeCommand({
        FunctionName: `${stackName}-ArchiveRecords`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          config: {
            expirationDays: 365 * 2,
          },
        }),
      }));
      if ($metadata.httpStatusCode >= 400) {
        throw new Error(`lambda invocation to run archival failed, code ${$metadata.httpStatusCode}`);
      }
      const granuleDetails = await getGranule({
        prefix: stackName,
        granuleId: granuleObject.body.granuleId,
      });
      expect(granuleDetails.archived).toEqual(false);
    });
    it('does archive records older than expirationDays', async () => {
      if (testSetupFailed) fail('test setup failed');
      const { $metadata } = await lambda().send(new InvokeCommand({
        FunctionName: `${stackName}-ArchiveRecords`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          config: {
            expirationDays: 365,
          },
        }),
      }));
      if ($metadata.httpStatusCode >= 400) {
        throw new Error(`lambda invocation to run archival failed, code ${$metadata.httpStatusCode}`);
      }
      const granuleDetails = await getGranule({
        prefix: stackName,
        granuleId: granuleObject.body.granuleId,
      });
      expect(granuleDetails.archived).toEqual(true);
    });
  });
});
