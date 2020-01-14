'use strict';

const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');
const test = require('ava');
const {
  parseS3Uri,
  recursivelyDeleteS3Bucket,
  s3Join
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const { testUtils: { randomString } } = require('@cumulus/common');
const {
  bucketsPrefixes, generateAndStoreDistributionReport, generateAndStoreReportsForEachDay
} = require('../../lambdas/ems-distribution-report');
const models = require('../../models');
const { fakeCollectionFactory, fakeGranuleFactoryV2, fakeFileFactory } = require('../../lib/testUtils');

// MYD13Q1___006 is reported to EMS
const collections = [
  fakeCollectionFactory({
    name: 'MYD13Q1',
    version: '006'
  }),
  fakeCollectionFactory({
    name: 'MOD14A1',
    version: '006',
    reportToEms: false
  })];

function fakeGranules() {
  const granules = [
    fakeGranuleFactoryV2({ collectionId: 'MYD13Q1___006' }),
    fakeGranuleFactoryV2({ collectionId: 'MOD14A1___006' })
  ];

  granules[0].files = [
    fakeFileFactory({
      bucket: 'my-dist-bucket',
      key: 'my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf',
      type: 'data'
    }),
    fakeFileFactory({
      bucket: 'my-dist-bucket',
      key: 'my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.cmr.xml',
      type: 'metadata'
    }),
    fakeFileFactory({
      bucket: 'my-public-dist-bucket',
      key: 'my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.jpg'
    })
  ];

  granules[1].files = [
    fakeFileFactory({
      bucket: 'my-dist-bucket2',
      key: 'MOD14A1___006/MOD/MOD14A1.A2739327.duVbLT.006.3445346596432_ndvi.jpg',
      type: 'browse'
    }),
    fakeFileFactory({
      bucket: 'my-dist-bucket2',
      key: 'MOD14A1___006/2017/MOD/MOD14A1.A0511093.PzaAbP.006.7020516472140.hdf'
    })
  ];
  return granules;
}

let expectedReportContentByTime;
let myd13GranId;

test.before(async () => {
  process.env.system_bucket = randomString();
  process.env.stackName = randomString();
  process.env.ems_provider = 'testEmsProvider';
  process.env.ems_retentionInDays = 100000;

  process.env.CollectionsTable = randomString();
  process.env.GranulesTable = randomString();
  process.env.FilesTable = randomString();
});

test.beforeEach(async (t) => {
  t.context.internalBucket = process.env.system_bucket;
  const { logsBucket, logsPrefix } = bucketsPrefixes();

  await awsServices.s3().createBucket({ Bucket: t.context.internalBucket }).promise();

  t.context.collectionModel = new models.Collection();
  t.context.granuleModel = new models.Granule();
  t.context.fileModel = new models.FileClass();

  await t.context.collectionModel.createTable();
  await t.context.collectionModel.create(collections);

  await t.context.granuleModel.createTable();
  await t.context.fileModel.createTable();

  const granules = fakeGranules();

  // MYD13Q1___006 granuleId
  myd13GranId = granules[0].granuleId;

  // only MYD13Q1___006 should be reported
  expectedReportContentByTime = [
    `01-JUN-81 01:01:13 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|MYD13Q1|&|006|&|${myd13GranId}|&|SCIENCE|&|HTTPS`,
    `01-JUN-81 01:02:13 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.cmr.xml|&|807|&|F|&|MYD13Q1|&|006|&|${myd13GranId}|&|METADATA|&|HTTPS`,
    `01-JUN-81 02:03:13 PM|&|-|&|192.0.2.3|&|s3://my-public-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.jpg|&|807|&|S|&|MYD13Q1|&|006|&|${myd13GranId}|&|OTHER|&|HTTPS`
  ];

  await Promise.all(granules.map(async (granule) => {
    await t.context.granuleModel.create(granule);
    await t.context.fileModel.createFilesFromGranule(granule);
  }));

  // Read in all of the server logs from the fixtures files
  const fixturesDirectory = path.join(__dirname, 'fixtures', 'ems-distribution-report');
  const serverLogFilenames = await fs.readdir(fixturesDirectory);
  const serverLogs = await Promise.all(serverLogFilenames.map((serverFilename) =>
    fs.readFile(path.join(fixturesDirectory, serverFilename), 'utf8')));

  // Upload the S3 server logs to the internal bucket
  await Promise.all(serverLogs.map((serverLog) =>
    awsServices.s3().putObject({
      Bucket: logsBucket,
      Key: s3Join([logsPrefix, `${randomString()}.log`]),
      Body: serverLog
    }).promise()));
});

test.afterEach.always(async (t) => {
  await Promise.all([
    t.context.fileModel.deleteTable(),
    t.context.granuleModel.deleteTable(),
    t.context.collectionModel.deleteTable()
  ]);
  await recursivelyDeleteS3Bucket(t.context.internalBucket);
});

test.serial('emsDistributionReport writes a correct report out to S3 when no previous reports exist', async (t) => {
  const reportsBucket = t.context.internalBucket;

  const startTime = '1981-06-01T01:00:00Z';
  const endTime = '1981-06-01T15:00:00Z';

  // Generate the distribution report
  const report = await generateAndStoreDistributionReport({ startTime, endTime });

  // Fetch the distribution report from S3
  const getObjectResponse = await awsServices.s3().getObject({
    Bucket: reportsBucket,
    Key: parseS3Uri(report.file).Key
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(logLines, expectedReportContentByTime);
});

test.serial('emsDistributionReport writes a correct report out to S3 when one report already exists', async (t) => {
  const startTime = '1981-06-01T01:00:00Z';
  const endTime = '1981-06-01T15:00:00Z';

  const reportName = `${moment.utc(startTime).format('YYYYMMDD')}_${process.env.ems_provider}_DistCustom_${process.env.stackName}.flt`;

  const { reportsBucket, reportsPrefix } = bucketsPrefixes();
  await awsServices.s3().putObject({
    Bucket: reportsBucket,
    Key: s3Join([reportsPrefix, reportName]),
    Body: 'my report'
  }).promise();

  // Generate the distribution report
  await generateAndStoreDistributionReport({ startTime, endTime });

  // Fetch the distribution report from S3
  const getObjectResponse = await awsServices.s3().getObject({
    Bucket: reportsBucket,
    Key: s3Join([reportsPrefix, `${reportName}.rev1`])
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(logLines, expectedReportContentByTime);
});

test.serial('emsDistributionReport writes a correct report out to S3 when two reports already exist', async (t) => {
  const startTime = '1981-06-01T01:00:00Z';
  const endTime = '1981-06-01T15:00:00Z';

  const { reportsBucket, reportsPrefix } = bucketsPrefixes();

  const reportName = `${moment.utc(startTime).format('YYYYMMDD')}_${process.env.ems_provider}_DistCustom_${process.env.stackName}.flt`;

  await Promise.all([
    awsServices.s3().putObject({
      Bucket: reportsBucket,
      Key: s3Join([reportsPrefix, reportName]),
      Body: 'my report'
    }).promise(),
    awsServices.s3().putObject({
      Bucket: reportsBucket,
      Key: s3Join([reportsPrefix, `${reportName}.rev1`]),
      Body: 'my report'
    }).promise()
  ]);

  // Generate the distribution report
  await generateAndStoreDistributionReport({ startTime, endTime });

  // Fetch the distribution report from S3
  const getObjectResponse = await awsServices.s3().getObject({
    Bucket: reportsBucket,
    Key: s3Join([reportsPrefix, `${reportName}.rev2`])
  }).promise();
  const logLines = getObjectResponse.Body.toString().split('\n');

  // Verify that the correct report was generated
  t.deepEqual(logLines, expectedReportContentByTime);
});

test.serial('emsDistributionReport writes multiple reports when report spans multiple days', async (t) => {
  const reportsBucket = t.context.internalBucket;

  // two days
  const startTime = '1981-06-01T00:00:00Z';
  const endTime = '1981-06-03T00:00:00Z';

  // Generate the distribution report
  const reports = await generateAndStoreReportsForEachDay({ startTime, endTime });

  t.is(reports.length, 2);

  const expectedContents = [
    [
      `01-JUN-81 12:02:13 AM|&|scrosby|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|MYD13Q1|&|006|&|${myd13GranId}|&|SCIENCE|&|HTTPS`,
      `01-JUN-81 01:01:13 AM|&|cbrown|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|MYD13Q1|&|006|&|${myd13GranId}|&|SCIENCE|&|HTTPS`,
      `01-JUN-81 01:02:13 AM|&|amalkin|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.cmr.xml|&|807|&|F|&|MYD13Q1|&|006|&|${myd13GranId}|&|METADATA|&|HTTPS`,
      `01-JUN-81 02:03:13 PM|&|-|&|192.0.2.3|&|s3://my-public-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf.jpg|&|807|&|S|&|MYD13Q1|&|006|&|${myd13GranId}|&|OTHER|&|HTTPS`,
      `01-JUN-81 04:02:13 PM|&|amurray|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|MYD13Q1|&|006|&|${myd13GranId}|&|SCIENCE|&|HTTPS`
    ],
    [
      `02-JUN-81 12:02:13 AM|&|mike|&|192.0.2.3|&|s3://my-dist-bucket/my-dist-folder/data/MYD13Q1.A2017297.h19v10.006.2017313221229.hdf|&|807|&|S|&|MYD13Q1|&|006|&|${myd13GranId}|&|SCIENCE|&|HTTPS`
    ]
  ];

  // Fetch the distribution reports from S3
  const reportContents = await Promise.all(
    reports.map(async (report) => {
      const getObjectResponse = await awsServices.s3().getObject({
        Bucket: reportsBucket,
        Key: parseS3Uri(report.file).Key
      }).promise();
      return getObjectResponse.Body.toString().split('\n');
    })
  );

  t.deepEqual(reportContents, expectedContents);
});
