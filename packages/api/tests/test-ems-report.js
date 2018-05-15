'use strict';

const test = require('ava');
const clone = require('lodash.clonedeep');
const delay = require('delay');
const moment = require('moment');
const { randomString } = require('@cumulus/common/test-utils');
const aws = require('@cumulus/common/aws');
const { bootstrapElasticSearch } = require('../lambdas/bootstrap');
const { Search } = require('../es/search');
const { generateReports } = require('../lib/ems');

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

process.env.ES_SCROLL_SIZE = 3;
const esIndex = randomString();
process.env.bucket = 'test-bucket';
process.env.stackName = 'test-stack';
process.env.ES_INDEX = esIndex;
process.env.ems_provider = 'testEmsProvider';

let esClient;

test.before(async () => {
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
    newgran.createdAt = moment().subtract(Math.floor(i / 10), 'days').toDate().getTime();
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
    newgran.deletedAt = moment().subtract(Math.floor(i / 5), 'days').toDate().getTime();
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
  await Promise.all(granjobs, deletedgranjobs);
  await delay(1000);
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test.beforeEach(async () => {
  await aws.s3().createBucket({ Bucket: process.env.bucket }).promise();
});

test.afterEach.always(async () => {
  await aws.recursivelyDeleteS3Bucket(process.env.bucket);
});

test.serial('generate reports for the previous day', async (t) => {
  // 24-hour period ending past midnight
  const endTime = moment().format('YYYY-MM-DD');
  const startTime = moment().subtract(1, 'days').format('YYYY-MM-DD');
  const reports = await generateReports(startTime, endTime);
  const requests = reports.map(async (report) => {
    const parsed = aws.parseS3Uri(report.file);
    // file exists
    const exists = await aws.fileExists(parsed.Bucket, parsed.Key);
    t.truthy(exists);

    // check the number of records for each report
    const records = (await aws.getS3Object(parsed.Bucket, parsed.Key)).Body.toString();
    const expectedNumRecords = (report.reportType === 'delete') ? 5 : 9;
    t.is(records.split('\n').length, expectedNumRecords);
  });
  await Promise.all(requests);
});

test.serial('generate reports for the past two days, and run multiple times', async (t) => {
  // 24-hour period ending past midnight
  const endTime = moment().format('YYYY-MM-DD');
  const startTime = moment().subtract(2, 'days').format('YYYY-MM-DD');
  let reports;
  for (let i = 0; i < 5; i += 1) {
    reports = await generateReports(startTime, endTime);
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
