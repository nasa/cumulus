'use strict';

const test = require('ava');
const sinon = require('sinon');
const uuidv4 = require('uuid/v4');

const S3 = require('@cumulus/aws-client/S3');
const { getMessageExecutionName } = require('@cumulus/message/Executions');

const { randomString } = require('@cumulus/common/test-utils');

const { fakeCumulusMessageFactory } = require('../../lib/testUtils');

const {
  processDeadLetterArchive,
} = require('../../lambdas/process-s3-dead-letter-archive');

test.before(async (t) => {
  t.context.bucket = randomString();
  await S3.createBucket(t.context.bucket);
});

test.beforeEach(async (t) => {
  t.context.stackName = randomString();
  t.context.path = `${t.context.stackName}/dead-letter-archive/sqs/`;
  t.context.sqsPath = `${t.context.stackName}/dead-letter-archive/sqsTest/`;
  const cumulusMessages = [
    fakeCumulusMessageFactory(),
    fakeCumulusMessageFactory(),
  ];

  t.context.SQSCumulusMessage = fakeCumulusMessageFactory();
  t.context.SQSCumulusMessage.stopDate = 150;

  const SQSMessage = {
    body: JSON.stringify(
      {
        detail: {
          status: 'SUCCEEDED',
          output: JSON.stringify(t.context.SQSCumulusMessage),
          startDate: t.context.SQSCumulusMessage.cumulus_meta.workflow_start_time,
          stopDate: t.context.SQSCumulusMessage.stopDate,
        },
      }
    ),
  };
  t.context.cumulusMessages = cumulusMessages;
  t.context.messageKeys = [
    `${t.context.path}${getMessageExecutionName(cumulusMessages[0])}.json`,
    `${t.context.path}${getMessageExecutionName(cumulusMessages[1])}.json`,
  ];
  await Promise.all(cumulusMessages.map((cumulusMessage, index) => {
    const key = t.context.messageKeys[index];
    return S3.putJsonS3Object(
      t.context.bucket,
      key,
      cumulusMessage
    );
  }));
  await S3.putJsonS3Object(
    t.context.bucket,
    `${t.context.sqsPath}/${getMessageExecutionName(t.context.SQSCumulusMessage)}`,
    SQSMessage
  );
});

test.after(async (t) => {
  await S3.recursivelyDeleteS3Bucket(t.context.bucket);
});

test('processDeadLetterArchive calls writeRecords for each dead letter Cumulus message', async (t) => {
  const writeRecordsFunctionSpy = sinon.spy();
  const { bucket, path } = t.context;
  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsFunctionSpy,
  });
  t.true(writeRecordsFunctionSpy.calledTwice);
  const messageArgs = writeRecordsFunctionSpy.getCalls().map((call) => call.args[0].cumulusMessage);
  t.is(messageArgs.filter(
    (argMsg) =>
      getMessageExecutionName(argMsg) === getMessageExecutionName(t.context.cumulusMessages[0])
  ).length, 1);
  t.is(messageArgs.filter(
    (argMsg) =>
      getMessageExecutionName(argMsg) === getMessageExecutionName(t.context.cumulusMessages[1])
  ).length, 1);
  t.deepEqual(
    {
      processingSucceededKeys: output.processingSucceededKeys.sort(),
      processingFailedKeys: [],
    },
    {
      processingSucceededKeys: t.context.messageKeys.sort(),
      processingFailedKeys: [],
    }
  );
});

test('processDeadLetterArchive is able to handle processing multiple batches of dead letter records', async (t) => {
  const { bucket } = t.context;
  const path = `${randomString()}/new-dead-letter-archive/`;
  const writeRecordsFunctionSpy = sinon.spy();

  const numberOfDeadLetters = 40;
  const keys = [];
  for (let i = 0; i < numberOfDeadLetters; i += 1) {
    const key = `${path}${uuidv4()}.json`;
    keys.push(key);
    // eslint-disable-next-line no-await-in-loop
    await S3.putJsonS3Object(
      bucket,
      key,
      {}
    );
  }

  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsFunctionSpy,
    batchSize: 15,
  });
  t.deepEqual(
    {
      processingSucceededKeys: output.processingSucceededKeys.sort(),
      processingFailedKeys: [],
    },
    {
      processingSucceededKeys: keys.sort(),
      processingFailedKeys: [],
    }
  );
  t.is(writeRecordsFunctionSpy.callCount, numberOfDeadLetters);
  const remainingDeadLetters = await S3.listS3ObjectsV2({ Bucket: bucket, Prefix: path });
  t.is(remainingDeadLetters.length, 0);
});

test('processDeadLetterArchive only deletes dead letters that process successfully', async (t) => {
  const { bucket, path } = t.context;
  const passingMessageExecutionName = getMessageExecutionName(t.context.cumulusMessages[1]);
  const failingMessageKey = t.context.messageKeys[0];
  const writeRecordsErrorThrower = ({ cumulusMessage }) => {
    if (getMessageExecutionName(cumulusMessage) === passingMessageExecutionName) return;
    throw new Error('write failure');
  };

  const output = await processDeadLetterArchive({
    bucket,
    path,
    writeRecordsFunction: writeRecordsErrorThrower,
  });

  const remainingDeadLetters = await S3.listS3ObjectsV2({ Bucket: bucket, Prefix: path });
  t.is(remainingDeadLetters.length, 1);
  t.deepEqual(output.processingFailedKeys, [failingMessageKey]);
});

test.serial('processDeadLetterArchive processes a SQS Message', async (t) => {
  const { bucket, sqsPath, SQSCumulusMessage } = t.context;
  const writeRecordsFunctionSpy = sinon.spy();

  const expected = { ...SQSCumulusMessage };
  expected.cumulus_meta.workflow_stop_time = SQSCumulusMessage.stopDate;

  await processDeadLetterArchive({
    bucket,
    path: sqsPath,
    writeRecordsFunction: writeRecordsFunctionSpy,
  });

  t.deepEqual(writeRecordsFunctionSpy.getCall(0).firstArg.cumulusMessage, SQSCumulusMessage);
});

test.serial('processDeadLetterArchive uses default values if no bucket and key are passed', async (t) => {
  const writeRecordsFunctionSpy = sinon.spy();
  process.env.system_bucket = t.context.bucket;
  process.env.stackName = t.context.stackName;
  await processDeadLetterArchive({
    writeRecordsFunction: writeRecordsFunctionSpy,
  });
  t.true(writeRecordsFunctionSpy.calledTwice);
  delete process.env.systemBucket;
  delete process.env.stackName;
});
