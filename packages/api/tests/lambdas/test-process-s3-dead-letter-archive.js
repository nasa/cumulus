'use strict';

const test = require('ava');
const sinon = require('sinon');

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
  const cumulusMessages = [
    fakeCumulusMessageFactory(),
    fakeCumulusMessageFactory(),
  ];
  t.context.cumulusMessages = cumulusMessages;
  await Promise.all(cumulusMessages.map((cumulusMessage) => {
    const executionName = getMessageExecutionName(cumulusMessage);
    return S3.putJsonS3Object(
      t.context.bucket,
      `${t.context.path}${executionName}.json`,
      cumulusMessage
    );
  }));
});

test.after(async (t) => {
  await S3.recursivelyDeleteS3Bucket(t.context.bucket);
});

test('processDeadLetterArchive calls writeRecords for each dead letter Cumulus message', async (t) => {
  const writeRecordsFunctionSpy = sinon.spy();
  const { bucket, path } = t.context;
  await processDeadLetterArchive({
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
