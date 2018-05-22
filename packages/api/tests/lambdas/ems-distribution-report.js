'use strict';

const emsDistributionReport = require('../../lambdas/ems-distribution-report');
const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');
const test = require('ava');
const { aws } = require('@cumulus/common');
const { testUtils: { randomString } } = require('@cumulus/common');

test.serial('emsDistributionReport writes a correct report out to S3', async (t) => {
  // Create the source and destination S3 buckets
  t.context.sourceBucket = randomString();
  t.context.destinationBucket = randomString();
  await Promise.all([
    aws.s3().createBucket({ Bucket: t.context.sourceBucket }).promise(),
    aws.s3().createBucket({ Bucket: t.context.destinationBucket }).promise()
  ]);

  // Read in all of the server logs from the fixtures files
  const fixturesDirectory = path.join(__dirname, 'fixtures', 'ems-distribution-report');
  const serverLogFilenames = await fs.readdir(fixturesDirectory);
  const serverLogs = await Promise.all(serverLogFilenames.map((serverFilename) =>
    fs.readFile(path.join(fixturesDirectory, serverFilename), 'utf8')));

  // Upload the S3 server logs to the source bucket
  await Promise.all(serverLogs.map((serverLog) =>
    aws.s3().putObject({
      Bucket: t.context.sourceBucket,
      Key: `${randomString()}.log`,
      Body: serverLog
    }).promise()));

  // Generate the distribution report
  const event = {
    startTime: moment('1981-06-01T01:00:00Z'),
    endTime: moment('1981-06-01T02:00:00Z')
  };
  process.env.SOURCE_BUCKET = t.context.sourceBucket;
  process.env.DESTINATION_BUCKET = t.context.destinationBucket;
  await emsDistributionReport.handler(event, {});

  // Fetch the distribution report from S3
  const getObjectResponse = await aws.s3().getObject({
    Bucket: t.context.destinationBucket,
    Key: '1981-06-01T01:00:00.000Z_to_1981-06-01T02:00:00.000Z.log'
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(
    logLines,
    [
      '1981-06-01T01:01:13.000Z|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S',
      '1981-06-01T01:02:13.000Z|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|F',
      '1981-06-01T01:03:13.000Z|&|tjefferson|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S'
    ]
  );
});

test.afterEach.always((t) =>
  Promise.all([
    aws.recursivelyDeleteS3Bucket(t.context.sourceBucket),
    aws.recursivelyDeleteS3Bucket(t.context.destinationBucket)
  ]));
