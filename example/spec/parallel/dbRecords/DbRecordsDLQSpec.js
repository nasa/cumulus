'use strict';

const { lambda, s3 } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const {
  deleteS3Object,
  listS3ObjectsV2,
  getObject,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');

const { loadConfig } = require('../../helpers/testUtils');
describe('when a bad record is ingested', () => {
  let stackName;
  let systemBucket;
  let executionArn;
  let failedMessageS3Key;

  let beforeAllSucceeded = false;
  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
    executionArn = `execution-${randomString(16)}`;
    systemBucket = config.bucket;
    const { $metadata } = await lambda().invoke({
      FunctionName: `${stackName}-sfEventSqsToDbRecords`,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        env: {},
        Records: [{
          Body: JSON.stringify({
            time: '4Oclock',
            detail: {
              executionArn: executionArn,
              stateMachineArn: '1234',
              status: 'RUNNING',
              input: JSON.stringify({
                meta: {
                  collection: {
                    name: 'A_COLLECTION',
                  },
                },
                payload: {
                  granules: [{ granuleId: 'a' }],
                },
                cumulus_meta: {
                  execution_name: executionArn,
                },
                a: 'sldkj',
              }),
            },
          }),
        }],
      }),
    });
    console.log(executionArn);
    if ($metadata.httpStatusCode < 400) {
      beforeAllSucceeded = true;
    }
  });
  // afterAll(async () => {
  //   await deleteS3Object(
  //     systemBucket,
  //     failedMessageS3Key
  //   );
  // });
  it('is sent to the DLA and processed to have expected metadata fields', async () => {
    if (!beforeAllSucceeded) fail('beforeAll() failed');
    console.log(`Waiting for the creation of failed message for execution ${executionArn}`);
    const prefix = `${stackName}/dead-letter-archive/sqs/${executionArn}`;

    try {
      await expectAsync(waitForListObjectsV2ResultCount({
        bucket: systemBucket,
        prefix,
        desiredCount: 1,
        interval: 5 * 1000,
        timeout: 30 * 1000,
      })).toBeResolved();
      // fetch key for cleanup
      const listResults = await listS3ObjectsV2({
        Bucket: systemBucket,
        Prefix: prefix,
      });
      failedMessageS3Key = listResults[0].Key;
    } catch (error) {
      fail(`Did not find expected S3 Object: ${error}`);
    }
    const s3Object = await getObject(
      s3(),
      {
        Bucket: systemBucket,
        Key: failedMessageS3Key,
      }
    );
    const fileBody = await getObjectStreamContents(s3Object.Body);

    const parsed = JSON.parse(fileBody);

    expect(parsed.status).toEqual('RUNNING');
    expect(parsed.time).toEqual('4Oclock');
    expect(parsed.stateMachine).toEqual('1234');
    expect(parsed.collection).toEqual('A_COLLECTION');
    expect(parsed.execution).toEqual(executionArn);
    expect(parsed.granules).toEqual(['a']);
    expect(parsed.error).toEqual('CumulusMessageError: getMessageWorkflowStartTime on a message without a workflow_start_time');
  });
});
