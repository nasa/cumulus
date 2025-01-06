'use strict';

const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const {
  promiseS3Upload,
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');
const {
  granules,
  collections,
} = require('@cumulus/api-client');

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { loadConfig } = require('../../helpers/testUtils');
const { constructCollectionId } = require('../../../../packages/message/Collections');
const { getTargetCollection, getProcessGranule, setupInitialState, getPayload, getTargetFiles } = require('./move-granule-collection-spec-utils')
describe('when moveGranulesCollection is called', () => {
  let stackName;
  const sourceUrlPrefix = `source_path/${uuidv4()}`;
  const targetUrlPrefix = `target_path/${uuidv4()}`;
  const targetCollection = getTargetCollection(targetUrlPrefix);
  const processGranule = getProcessGranule(sourceUrlPrefix)
  
  // let systemBucket;
  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
  });

  describe('under normal circumstances', () => {
    let beforeAllFailed = false;
    let finalFiles;
    afterAll(async () => {
      await Promise.all(finalFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      )));
    });
    beforeAll(async () => {
      finalFiles = getTargetFiles()

      const payload = getPayload(sourceUrlPrefix, targetUrlPrefix);
      //upload to cumulus
      try {
        await setupInitialState();
        const { $metadata } = await lambda().send(new InvokeCommand({
          FunctionName: `${stackName}-MoveGranuleCollections`,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            cma: {
              meta: payload.meta,
              task_config: payload.config,
              event: {
                payload: payload.input,
              },
            },
          }),
        }));
        console.log($metadata.httpStatusCode);
        if ($metadata.httpStatusCode >= 400) {
          console.log(`lambda invocation to set up failed, code ${$metadata.httpStatusCode}`);
          beforeAllFailed = true;
        }

        await Promise.all(finalFiles.map((file) => expectAsync(
          waitForListObjectsV2ResultCount({
            bucket: file.bucket,
            prefix: file.key,
            desiredCount: 1,
            interval: 5 * 1000,
            timeout: 30 * 1000,
          })
        ).toBeResolved()));
      } catch (error) {
        console.log(`files do not appear to have been moved: error: ${error}`);
        beforeAllFailed = true;
      }
    });
    it('moves the granule data in s3', () => {
      if (beforeAllFailed) fail('beforeAllFailed');
    });
    it('updates the granule data in cumulus', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
      const cumulusGranule = await granules.getGranule({
        prefix: stackName,
        granuleId: processGranule.granuleId,
      });
      expect(cumulusGranule.granuleId).toEqual(processGranule.granuleId);
      expect(cumulusGranule.collectionId).toEqual(constructCollectionId(targetCollection.name, targetCollection.version));
    });
  });
});
