'use strict';

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { SQS } = require('@cumulus/aws-client');
const { lambda } = require('@cumulus/aws-client/services')
const { randomString } = require('@cumulus/common/test-utils');
const {
  deleteS3Object,
  listS3ObjectsV2,
  getS3Object,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');

const { loadConfig } = require('../../helpers/testUtils');
describe('when a bad record is ingested', () => {
  let stackName;
  let systemBucket;
  let dbRecordsDLQUrl;
  let executionName;
  let failedMessageS3Key;

  let beforeAllSucceeded = false;
  beforeAll(async () => {
    const config = await loadConfig();
    stackName = config.stackName;
    executionName = `execution-${randomString(16)}`;
    systemBucket = config.bucket;
    const fname = `${stackName}-sfEventSqsToDbRecords`;
    const a = await lambda().invoke({
      FunctionName: `${stackName}-sfEventSqsToDbRecords`,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        env: {},
        Records: [{
          Body: JSON.stringify({
            detail: {
              status: 'RUNNING',
              input: JSON.stringify({
                cumulus_meta: {
                  execution_name: executionName,
                },
                a: 'sldkj',
              }),
            },
          }),
        }],
      }),
    });
    beforeAllSucceeded = true;
  });
  afterAll(async () => {
    await deleteS3Object(
      systemBucket,
      failedMessageS3Key
    );
  });
  it('is sent to the DLA', async () => {
    if (!beforeAllSucceeded) fail('beforeAll() failed');
    console.log(`Waiting for the creation of failed message for execution ${executionName}`);
    const prefix = `${stackName}/dead-letter-archive/sqs/${executionName}`;
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
    const s3Object = await getS3Object(systemBucket, failedMessageS3Key);
    const fileBody = await getObjectStreamContents(s3Object.Body);

    const parsed = JSON.parse(fileBody);
    expect(parsed.execution).toEqual('unknown');
    expect(parsed.granules).toEqual('unknown');
    expect(parsed.error).toEqual('CumulusMessageError: getMessageWorkflowStartTime on a message without a workflow_start_time')
  });
});
// describe('When a bad record is sent on the DLQ', () => {
//   let beforeAllSucceeded = false;
//   let stackName;
//   let systemBucket;
//   let dbRecordsDLQUrl;
//   let executionName;
//   let failedMessageS3Key;

//   beforeAll(async () => {
//     const config = await loadConfig();
//     stackName = config.stackName;
//     systemBucket = config.bucket;

//     const DLQName = `${stackName}-sfEventSqsToDbRecordsDeadLetterQueue`;
//     dbRecordsDLQUrl = await SQS.getQueueUrlByName(DLQName);

//     const granuleId = randomString(10);
//     const files = [fakeFileFactory()];
//     const granule = fakeGranuleFactoryV2({ files, granuleId, published: false });

//     executionName = `execution-${randomString(16)}`;

//     const failingMessage = {
//       cumulus_meta: {
//         workflow_start_time: 122,
//         cumulus_version: '8.0.0',
//         state_machine: 'arn:aws:states:us-east-1:1234:execution:state-machine-name:execution-name',
//         execution_name: executionName,
//       },
//       meta: {
//         status: 'failed',
//         collection: 'bad-collection',
//         provider: 'fake-provider',
//       },
//       payload: {
//         granules: [granule],
//       },
//     };

//     // Send the message directly on the DLQ. Sending the message on the input queue results in an
//     // extremely long-duration, unreliable test (>20 mins) because updates to the redrive policy
//     // are very slow and unreliable and our normal visibilityTimeout and maxReceiveCount are high.
//     await SQS.sendSQSMessage(dbRecordsDLQUrl, JSON.stringify(failingMessage));
//     beforeAllSucceeded = true;
//   });

//   afterAll(async () => {
//     await deleteS3Object(
//       systemBucket,
//       failedMessageS3Key
//     );
//   });

//   describe('the writeDbDlqRecordstoS3 lambda', () => {
//     it('takes the message off the queue and writes it to S3', async () => {
//       if (!beforeAllSucceeded) fail('beforeAll() failed');
//       else {
//         console.log(`Waiting for the creation of failed message for execution ${executionName}`);
//         const prefix = `${stackName}/dead-letter-archive/sqs/${executionName}`;
//         try {
//           await expectAsync(waitForListObjectsV2ResultCount({
//             bucket: systemBucket,
//             prefix,
//             desiredCount: 1,
//             interval: 5 * 1000,
//             timeout: 30 * 1000,
//           })).toBeResolved();
//           // fetch key for cleanup
//           const listResults = await listS3ObjectsV2({
//             Bucket: systemBucket,
//             Prefix: prefix,
//           });
//           failedMessageS3Key = listResults[0].Key;
//         } catch (error) {
//           fail(`Did not find expected S3 Object: ${error}`);
//         }
//       }
//     });
//   });
// });
