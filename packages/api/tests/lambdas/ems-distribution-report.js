'use strict';

const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');
const test = require('ava');
const { aws } = require('@cumulus/common');
const { testUtils: { randomString } } = require('@cumulus/common');
const { generateAndStoreDistributionReport } = require('../../lambdas/ems-distribution-report');
const models = require('../../models');
const { fakeGranuleFactory, fakeFileFactory } = require('../../lib/testUtils');

process.env.system_bucket = 'test-bucket';
process.env.stackName = 'test-stack';
process.env.ems_provider = 'testEmsProvider';

let granuleId;

test.before(async () => {
  process.env.GranulesTable = randomString();
  process.env.FilesTable = randomString();

  const fileModel = new models.FileClass();
  const granuleModel = new models.Granule();
  await granuleModel.createTable();
  await fileModel.createTable();

  // add file and granule
  const bucket = 'my-dist-bucket';
  const key = 'my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf';
  const granule = fakeGranuleFactory();
  granule.files = [fakeFileFactory({ bucket, key })];
  granuleId = granule.granuleId;

  await granuleModel.create(granule);
  await fileModel.createFilesFromGranule(granule);
});

test.after.always(async () => {
  Promise.all([
    new models.FileClass().deleteTable(),
    new models.Granule().deleteTable()]);
});


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

  const reportStartTime = moment.utc('1981-06-01T01:00:00Z');
  const reportEndTime = moment.utc('1981-06-01T15:00:00Z');

  // Generate the distribution report
  const report = await generateAndStoreDistributionReport({
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
    Key: aws.parseS3Uri(report.file).Key
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(
    logLines,
    [
      `01-JUN-81 01.01.13.000000 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|fakeCollection|&|v1|&|${granuleId}`,
      `01-JUN-81 01.02.13.000000 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|F|&|fakeCollection|&|v1|&|${granuleId}`,
      `01-JUN-81 02.03.13.000000 PM|&|tjefferson|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|fakeCollection|&|v1|&|${granuleId}`
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

  const reportStartTime = moment.utc('1981-06-01T01:00:00Z');
  const reportEndTime = moment.utc('1981-06-01T15:00:00Z');

  const reportName = `${reportStartTime.format('YYYYMMDD')}_${process.env.ems_provider}_DistCustom_${process.env.stackName}.flt`;

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
      `01-JUN-81 01.01.13.000000 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|fakeCollection|&|v1|&|${granuleId}`,
      `01-JUN-81 01.02.13.000000 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|F|&|fakeCollection|&|v1|&|${granuleId}`,
      `01-JUN-81 02.03.13.000000 PM|&|tjefferson|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|fakeCollection|&|v1|&|${granuleId}`
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

  const reportStartTime = moment.utc('1981-06-01T01:00:00Z');
  const reportEndTime = moment.utc('1981-06-01T15:00:00Z');

  const reportName = `${reportStartTime.format('YYYYMMDD')}_${process.env.ems_provider}_DistCustom_${process.env.stackName}.flt`;

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
      `01-JUN-81 01.01.13.000000 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|fakeCollection|&|v1|&|${granuleId}`,
      `01-JUN-81 01.02.13.000000 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|F|&|fakeCollection|&|v1|&|${granuleId}`,
      `01-JUN-81 02.03.13.000000 PM|&|tjefferson|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|fakeCollection|&|v1|&|${granuleId}`
    ]
  );
});
