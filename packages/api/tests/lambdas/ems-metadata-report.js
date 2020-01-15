'use strict';

const test = require('ava');
const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');
const sinon = require('sinon');
const { randomString } = require('@cumulus/common/test-utils');
const awsServices = require('@cumulus/aws-client/services');
const {
  fileExists,
  parseS3Uri,
  getS3Object,
  recursivelyDeleteS3Bucket
} = require('@cumulus/aws-client/S3');
const { CMR, CMRSearchConceptQueue } = require('@cumulus/cmrjs');
const { fakeCollectionFactory } = require('../../lib/testUtils');
const { generateReport } = require('../../lambdas/ems-metadata-report');
const models = require('../../models');

async function addTestCollections() {
  // Read in all of the CMR collections from the fixtures files
  const fixturesDirectory = path.join(__dirname, 'fixtures', 'ems-metadata-report');
  const collectionFilenames = await fs.readdir(fixturesDirectory);
  const cmrCollections = await Promise.all(
    collectionFilenames.map((collectionFilename) =>
      fs.readFile(path.join(fixturesDirectory, collectionFilename), 'utf8')
        .then((collection) => JSON.parse(collection)))
  );

  // verify that the function handles different CMR collections:
  // MYD13Q1___006 has single ScienceKeywords.ScienceKeyword
  // MUR-JPL-L4-GLOB-v4.1___1 has single ScienceKeywords.ScienceKeyword,
  //    multiple platforms and instruments
  // A2_SI25_NRT___0 has multiple ScienceKeywords.ScienceKeyword
  // MOD11A1___006 has multiple ScienceKeywords.ScienceKeyword
  // MOD14A1___006 has multiple ScienceKeywords.ScienceKeyword

  // Create collections that are in both CUMULUS and CMR
  // the MOD11A1___006 is in CMR only
  // set collection's reportToEms to true except MOD14A1___006
  const matchingColls = cmrCollections.map((cmrCollection) =>
    fakeCollectionFactory({
      name: cmrCollection.Collection.ShortName,
      version: cmrCollection.Collection.VersionId,
      reportToEms: (cmrCollection.Collection.ShortName !== 'MOD14A1')
    }))
    .filter((collection) => (collection.name !== 'MOD11A1'));

  // collection only in cumulus
  const extraDbColls = fakeCollectionFactory({ name: 'TEST', version: '0', reportToEms: true });

  await new models.Collection().create(matchingColls.concat(extraDbColls));

  CMRSearchConceptQueue.prototype.peek.restore();
  CMRSearchConceptQueue.prototype.shift.restore();
  sinon.stub(CMRSearchConceptQueue.prototype, 'peek').callsFake(() => cmrCollections[0]);
  sinon.stub(CMRSearchConceptQueue.prototype, 'shift').callsFake(() => cmrCollections.shift());

  await new models.Collection().create(matchingColls.concat(extraDbColls));
}

test.beforeEach(async (t) => {
  process.env.system_bucket = randomString();
  process.env.stackName = 'test-stack';
  process.env.ems_provider = 'testEmsProvider';
  process.env.CollectionsTable = randomString();

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  t.context.collectionModel = new models.Collection();
  await t.context.collectionModel.createTable();
  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => []);
  sinon.stub(CMRSearchConceptQueue.prototype, 'peek').callsFake(() => null);
  sinon.stub(CMRSearchConceptQueue.prototype, 'shift').callsFake(() => null);

  await addTestCollections();
});

test.afterEach.always((t) => {
  Promise.all([
    recursivelyDeleteS3Bucket(process.env.system_bucket),
    t.context.collectionModel.deleteTable()]);
  CMR.prototype.searchCollections.restore();
  CMRSearchConceptQueue.prototype.peek.restore();
  CMRSearchConceptQueue.prototype.shift.restore();
});

test.serial('generateReport creates flat file for collections in both CUMULUS and CMR', async (t) => {
  // 24-hour period ending today's midnight utc
  const startTime = moment.utc().startOf('day');
  const endTime = moment.utc().add(1, 'days').startOf('day');
  const report = await generateReport(startTime, endTime);
  const parsed = parseS3Uri(report.file);

  // file exists
  const exists = await fileExists(parsed.Bucket, parsed.Key);
  t.truthy(exists);

  const expectedRecords = [
    'A2_SI25_NRT|&|NRT AMSR2 DAILY L3 25 KM TB AND SEA ICE CONCENTRATION POLAR GRIDS V0|&|'
    + '3|&|SPECTRAL/ENGINEERING,CRYOSPHERE,OCEANS|&|NASA/MSFC/GHRC|&|testEmsProvider|&|GCOM-W1|&|AMSR2|&|E|&|1',

    'MUR-JPL-L4-GLOB-v4.1|&|PODAAC-GHGMR-4FJ04|&|'
    + '4|&|Oceans|&|Jet Propulsion Laboratory|&|testEmsProvider|&|'
    + 'NOAA-18;Coriolis;TERRA;AQUA|&|AVHRR-3;WindSat;MODIS;AMSR-E,MODIS|&|E|&|1',

    'MYD13Q1|&|MODIS/Aqua Vegetation Indices 16-Day L3 Global 250m SIN Grid V006|&|'
    + '3|&|BIOSPHERE|&|NASA/GSFC/SED/ESD/HBSL/BISB/MODAPS|&|testEmsProvider|&|AQUA|&|MODIS|&|E|&|1'
  ];
  // check the number of records for each report
  const s3Object = await getS3Object(parsed.Bucket, parsed.Key);
  const content = s3Object.Body.toString();
  const records = content.split('\n');
  t.deepEqual(records, expectedRecords);
});

test.serial('generateReport creates flat file for one collection which is in both CUMULUS and CMR', async (t) => {
  // 24-hour period ending today's midnight utc
  const startTime = moment.utc().startOf('day');
  const endTime = moment.utc().add(1, 'days').startOf('day');
  const report = await generateReport(startTime, endTime, 'A2_SI25_NRT___0');
  const parsed = parseS3Uri(report.file);

  // file exists
  const exists = await fileExists(parsed.Bucket, parsed.Key);
  t.truthy(exists);

  const expectedRecords = [
    'A2_SI25_NRT|&|NRT AMSR2 DAILY L3 25 KM TB AND SEA ICE CONCENTRATION POLAR GRIDS V0|&|'
    + '3|&|SPECTRAL/ENGINEERING,CRYOSPHERE,OCEANS|&|NASA/MSFC/GHRC|&|testEmsProvider|&|GCOM-W1|&|AMSR2|&|E|&|1'
  ];
  // check the number of records for each report
  const s3Object = await getS3Object(parsed.Bucket, parsed.Key);
  const content = s3Object.Body.toString();
  const records = content.split('\n');
  t.deepEqual(records, expectedRecords);
});
