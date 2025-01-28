'use strict';

const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const {
  deleteS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');

const { v4: uuidv4 } = require('uuid');
const { loadConfig } = require('../../helpers/testUtils');
const { getProcessGranule, setupInitialState, getPayload, getTargetFiles } = require('./move-granule-collection-spec-utils');
describe('when moveGranulesCollection is called', () => {
  let stackName;
  const sourceUrlPrefix = `source_path/${uuidv4()}`;
  const targetUrlPrefix = `target_path/${uuidv4()}`;
  let processGranule;
  let config;
  beforeAll(async () => {
    config = await loadConfig();
    stackName = config.stackName;
    processGranule = getProcessGranule(sourceUrlPrefix, config);
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
      finalFiles = getTargetFiles(targetUrlPrefix, config);
      const payload = getPayload(sourceUrlPrefix, targetUrlPrefix, config);
      //upload to cumulus
      try {
        await setupInitialState(stackName, sourceUrlPrefix, targetUrlPrefix, config);
        const { $metadata } = await lambda().send(new InvokeCommand({
          FunctionName: `${stackName}-ChangeGranuleCollectionS3s`,
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
            timeout: 60 * 1000,
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
    it('updates the granule data in s3', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');

      finalFiles = getTargetFiles(targetUrlPrefix, config);
      await Promise.all(finalFiles.map(async (file) => {
        expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
      }));
    });
    it('keeps old s3 files as well', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
      await Promise.all(processGranule.files.map(async (file) => {
        expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
      }));
    });
  });
});
