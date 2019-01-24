'use strict';

const test = require('ava');
const clone = require('lodash.clonedeep');
const moment = require('moment');
const { randomString } = require('@cumulus/common/test-utils');
const aws = require('@cumulus/common/aws');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const { Search } = require('../../es/search');
const { deleteAliases } = require('../../lib/testUtils');
const { emsMappings, generateReports } = require('../../lib/ems');

const granule = {
  granuleId: randomString(),
  collectionId: 'MOD09GQ___006',
  productVolume: 12345,
  status: 'completed',
  provider: 's3provider',
  processingStartDateTime: '2018-05-25T21:45:00.000001',
  processingEndDateTime: '2018-05-25T21:45:45.524053',
  published: 'true',
  timeToArchive: 6,
  timeToPreprocess: 7,
  duration: 8,
  createdAt: Date.now(),
  files: ['file1', 'file2'],
  beginningDateTime: '2017-10-24T00:00:00Z',
  endingDateTime: '2017-11-08T23:59:59Z',
  productionDateTime: '2017-11-10T03:12:24.000Z',
  lastUpdateDateTime: '2018-04-25T21:45:45.524053'
};

const deletedgranule = Object.assign(clone(granule), { deletedAt: Date.now() });

// report type and its regex for each field
const datetimeRegx = '^(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2})(A|P)M$';
const decimalIntRegx = '^-?\\d+\\.?\\d*$';
const granuleIdRegx = '^[a-zA-Z0-9\\.-_]+$';
const formatMappings = {
  ingest: [
    granuleIdRegx, // dbID
    '^[a-zA-Z0-9-_]+$', // product
    '^\\d+$', // versionID
    '^\\d+$', // productVolume
    '^(Successful|Failed)$', // productState
    '^[a-zA-Z0-9\\.-_]+$', // externalDataProvider
    datetimeRegx, // processingStartDateTime
    datetimeRegx, // processingEndDateTime
    decimalIntRegx, // timeToArchive
    decimalIntRegx, // timeToPreprocess
    decimalIntRegx //timeToXfer
  ],

  archive: [
    granuleIdRegx, // dbID
    '^[a-zA-Z0-9-_]+$', // product
    '^\\d+$', // productVolume
    '^\\d+$', // totalFiles
    datetimeRegx, // insertTime
    datetimeRegx, // beginningDateTime
    datetimeRegx, // endingDateTime
    datetimeRegx, // productionDateTime
    granuleIdRegx, // localGranuleID
    '^\\d+$', // versionID
    '^N$', // deleteFromArchive 'N'
    '^$', // deleteEffectiveDate null
    datetimeRegx // lastUpdate
  ],

  delete: [
    granuleIdRegx, // dbID
    datetimeRegx // deleteEffectiveDate
  ]
};

process.env.ES_SCROLL_SIZE = 3;
const esIndex = randomString();
process.env.system_bucket = 'test-bucket';
process.env.stackName = 'test-stack';
process.env.ES_INDEX = esIndex;
process.env.ems_provider = 'testEmsProvider';

let esClient;

test.before(async () => {
  await deleteAliases();

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex);
  esClient = await Search.es();

  // add 30 granules to es, 10 from 1 day ago, 10 from 2 day ago, 10 from today.
  // one granule from each day is 'running', and should not be included in report.
  // one granule from each day is 'failed' and should be included in report.
  const granules = [];
  for (let i = 0; i < 30; i += 1) {
    const newgran = clone(granule);
    newgran.granuleId = randomString();
    newgran.createdAt = moment.utc().subtract(Math.floor(i / 10), 'days').toDate().getTime();
    if (i % 10 === 2) newgran.status = 'failed';
    if (i % 10 === 3) newgran.status = 'running';
    granules.push(newgran);
  }

  const granjobs = granules.map((g) => esClient.update({
    index: esIndex,
    type: 'granule',
    id: g.granuleId,
    parent: g.collectionId,
    body: {
      doc: g,
      doc_as_upsert: true
    }
  }));

  // add 15 deleted granules to es, 5 from 1 day ago, 5 from 2 day ago, 5 from today
  const deletedgrans = [];
  for (let i = 0; i < 15; i += 1) {
    const newgran = clone(deletedgranule);
    newgran.granuleId = randomString();
    newgran.deletedAt = moment.utc().subtract(Math.floor(i / 5), 'days').toDate().getTime();
    if (i % 5 === 2) newgran.status = 'failed';
    deletedgrans.push(newgran);
  }
  const deletedgranjobs = deletedgrans.map((g) => esClient.update({
    index: esIndex,
    type: 'deletedgranule',
    id: g.granuleId,
    parent: g.collectionId,
    body: {
      doc: g,
      doc_as_upsert: true
    }
  }));
  await Promise.all(granjobs.concat(deletedgranjobs));
  return esClient.indices.refresh();
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test.beforeEach(async () => {
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
});

test.afterEach.always(async () => {
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.serial('generate reports for the previous day', async (t) => {
  // 24-hour period ending past midnight utc
  const endTime = moment.utc().startOf('day').toDate().toUTCString();
  const startTime = moment.utc().subtract(1, 'days').startOf('day').toDate()
    .toUTCString();
  const reports = await generateReports(startTime, endTime);
  const requests = reports.map(async (report) => {
    const parsed = aws.parseS3Uri(report.file);
    // file exists
    const exists = await aws.fileExists(parsed.Bucket, parsed.Key);
    t.truthy(exists);

    // check the number of records for each report
    const content = (await aws.getS3Object(parsed.Bucket, parsed.Key)).Body.toString();
    const records = content.split('\n');
    const expectedNumRecords = (report.reportType === 'delete') ? 5 : 9;
    t.is(records.length, expectedNumRecords);

    // check the number of fields for each record
    const expectedNumFields = Object.keys(emsMappings[report.reportType]).length;
    records.forEach((record) => {
      const fields = record.split('|&|');
      t.is(fields.length, expectedNumFields);
      // check each field has the correct format
      for (let i = 0; i < fields.length; i += 1) {
        t.truthy(fields[i].match(formatMappings[report.reportType][i]));
      }
    });
  });
  await Promise.all(requests);
});

test.serial('generate reports for the past two days, and run multiple times', async (t) => {
  // 2-day period ending past midnight utc
  const endTime = moment.utc().startOf('day').toDate().toUTCString();
  const startTime = moment.utc().subtract(2, 'days').startOf('day').toDate()
    .toUTCString();
  let reports;
  for (let i = 0; i < 5; i += 1) {
    reports = await generateReports(startTime, endTime); // eslint-disable-line no-await-in-loop
  }

  const requests = reports.map(async (report) => {
    const parsed = aws.parseS3Uri(report.file);

    // filenames from last run end with rev[1-n]
    t.true(report.file.endsWith('.flt.rev4'));

    // file exists
    const exists = await aws.fileExists(parsed.Bucket, parsed.Key);
    t.truthy(exists);

    // check the number of records for each report
    const records = (await aws.getS3Object(parsed.Bucket, parsed.Key)).Body.toString();
    const expectedNumRecords = (report.reportType === 'delete') ? 10 : 18;
    t.is(records.split('\n').length, expectedNumRecords);
  });
  await Promise.all(requests);
});
