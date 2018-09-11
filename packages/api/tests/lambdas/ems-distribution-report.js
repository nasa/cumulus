'use strict';

const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');
const test = require('ava');
const { aws } = require('@cumulus/common');
const { testUtils: { randomString } } = require('@cumulus/common');
const { generateAndStoreDistributionReport } = require('../../lambdas/ems-distribution-report');

test.beforeEach(async (t) => {
  // Create the internal bucket
  t.context.internalBucket = randomString();
  await aws.s3().createBucket({ Bucket: t.context.internalBucket }).promise();

  // Read in all of the server logs from the fixtures files
  const fixturesDirectory = path.join(__dirname, 'fixtures', 'ems-distribution-report');
  const serverLogFilenames = await fs.readdir(fixturesDirectory);
  const serverLogs = await Promise.all(serverLogFilenames.map((serverFilename) =>
    fs.readFile(path.join(fixturesDirectory, serverFilename), 'utf8')));

  // Upload the S3 server logs to the internal bucket
  t.context.logsPrefix = randomString();
  await Promise.all(serverLogs.map((serverLog) =>
    aws.s3().putObject({
      Bucket: t.context.internalBucket,
      Key: aws.s3Join([t.context.logsPrefix, `${randomString()}.log`]),
      Body: serverLog
    }).promise()));
});

test.afterEach.always(async (t) => {
  await aws.recursivelyDeleteS3Bucket(t.context.internalBucket);
});

test.serial('emsDistributionReport writes a correct report out to S3 when no previous reports exist', async (t) => {
  const logsBucket = t.context.internalBucket;
  const logsPrefix = t.context.logsPrefix;

  const reportsBucket = t.context.internalBucket;
  const reportsPrefix = randomString();

  const provider = randomString();
  const stackName = randomString();

  const reportStartTime = moment('1981-06-01T01:00:00Z');
  const reportEndTime = moment('1981-06-01T15:00:00Z');

  // Generate the distribution report
  await generateAndStoreDistributionReport({
    reportStartTime,
    reportEndTime,
    logsBucket,
    logsPrefix,
    reportsBucket,
    reportsPrefix,
    stackName,
    provider
  });

  const reportName = `${reportStartTime.format('YYYYMMDD')}_${provider}_DistCustom_${stackName}.flt`;

  // Fetch the distribution report from S3
  const getObjectResponse = await aws.s3().getObject({
    Bucket: reportsBucket,
    Key: aws.s3Join([reportsPrefix, reportName])
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(
    logLines,
    [
      '01-JUN-81 01.01.13.000000 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S',
      '01-JUN-81 01.02.13.000000 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|F',
      '01-JUN-81 02.03.13.000000 PM|&|tjefferson|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S'
    ]
  );
});

test.serial('emsDistributionReport writes a correct report out to S3 when one report already exists', async (t) => {
  const logsBucket = t.context.internalBucket;
  const logsPrefix = t.context.logsPrefix;

  const reportsBucket = t.context.internalBucket;
  const reportsPrefix = randomString();

  const provider = randomString();
  const stackName = randomString();

  const reportStartTime = moment('1981-06-01T01:00:00Z');
  const reportEndTime = moment('1981-06-01T15:00:00Z');

  const reportName = `${reportStartTime.format('YYYYMMDD')}_${provider}_DistCustom_${stackName}.flt`;

  await aws.s3().putObject({
    Bucket: reportsBucket,
    Key: aws.s3Join([reportsPrefix, reportName]),
    Body: 'my report'
  }).promise();

  // Generate the distribution report
  await generateAndStoreDistributionReport({
    reportStartTime,
    reportEndTime,
    logsBucket,
    logsPrefix,
    reportsBucket,
    reportsPrefix,
    stackName,
    provider
  });

  // Fetch the distribution report from S3
  const getObjectResponse = await aws.s3().getObject({
    Bucket: reportsBucket,
    Key: aws.s3Join([reportsPrefix, `${reportName}.rev1`])
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(
    logLines,
    [
      '01-JUN-81 01.01.13.000000 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S',
      '01-JUN-81 01.02.13.000000 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|F',
      '01-JUN-81 02.03.13.000000 PM|&|tjefferson|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S'
    ]
  );
});

test.serial('emsDistributionReport writes a correct report out to S3 when two reports already exist', async (t) => {
  const logsBucket = t.context.internalBucket;
  const logsPrefix = t.context.logsPrefix;

  const reportsBucket = t.context.internalBucket;
  const reportsPrefix = randomString();

  const provider = randomString();
  const stackName = randomString();

  const reportStartTime = moment('1981-06-01T01:00:00Z');
  const reportEndTime = moment('1981-06-01T15:00:00Z');

  const reportName = `${reportStartTime.format('YYYYMMDD')}_${provider}_DistCustom_${stackName}.flt`;

  await Promise.all([
    aws.s3().putObject({
      Bucket: reportsBucket,
      Key: aws.s3Join([reportsPrefix, reportName]),
      Body: 'my report'
    }).promise(),
    aws.s3().putObject({
      Bucket: reportsBucket,
      Key: aws.s3Join([reportsPrefix, `${reportName}.rev1`]),
      Body: 'my report'
    }).promise()
  ]);

  // Generate the distribution report
  await generateAndStoreDistributionReport({
    reportStartTime,
    reportEndTime,
    logsBucket,
    logsPrefix,
    reportsBucket,
    reportsPrefix,
    stackName,
    provider
  });

  // Fetch the distribution report from S3
  const getObjectResponse = await aws.s3().getObject({
    Bucket: reportsBucket,
    Key: aws.s3Join([reportsPrefix, `${reportName}.rev2`])
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(
    logLines,
    [
      '01-JUN-81 01.01.13.000000 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S',
      '01-JUN-81 01.02.13.000000 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|F',
      '01-JUN-81 02.03.13.000000 PM|&|tjefferson|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-bucket/pdrs/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.PDR|&|807|&|S'
    ]
  );
});
