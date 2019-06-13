'use strict';

const moment = require('moment');
const get = require('lodash.get');
const isFunction = require('lodash.isfunction');
const sortBy = require('lodash.sortby');

const {
  aws: {
    buildS3Uri,
    deleteS3Files,
    s3
  },
  constructCollectionId
} = require('@cumulus/common');
const { log } = require('@cumulus/common');
const { CMRSearchConceptQueue } = require('@cumulus/cmrjs');
const {
  determineReportKey, getExpiredS3Objects, submitReports
} = require('../lib/ems');

const { Collection } = require('../models');

const bucketsPrefixes = () => ({
  reportsBucket: process.env.system_bucket,
  reportsPrefix: `${process.env.stackName}/ems/`,
  reportsSentPrefix: `${process.env.stackName}/ems/sent/`
});
exports.bucketsPrefixes = bucketsPrefixes;

/**
 * Get discipline
 * @param {Object} collection - CMR collection object
 * @returns {string} discpline
 */
const discipline = (collection) => {
  let scienceKeywords = get(collection, 'ScienceKeywords.ScienceKeyword', []);
  console.log('scienceKeywords', scienceKeywords);
  scienceKeywords = (Array.isArray(scienceKeywords))
    ? scienceKeywords : [scienceKeywords];

  return scienceKeywords
    .map((scienceKeyword) => scienceKeyword.TopicKeyword)
    .filter((elem, pos, arr) => arr.indexOf(elem) === pos)
    .join(', ');
};

const platforms = (collection) => {
  const platform = get(collection, 'Platforms.Platform', []);
  return Array.isArray(platform) ? platform : [platform];
};

const mission = (collection) =>
  platforms(collection).map((platform) => platform.ShortName).join(';');

function buildInstrumentsString(platform) {
  let instruments = get(platform, 'Instruments.Instrument', []);
  instruments = (Array.isArray(instruments)) ? instruments : [instruments];
  return instruments.map((instrument) => instrument.ShortName).join(',');
}

const instrument = (collection) =>
  platforms(collection)
    .map((platform) => buildInstrumentsString(platform))
    .join(';');

const emsMapping = {
  product: (collection) => collection.ShortName,
  metaDataLongName: (collection) => collection.LongName,
  productLevel: (collection) => collection.ProcessingLevelId.replace(/^Level\s?/i, ''), // optional field
  discipline: discipline, // optional field
  processingCenter: (collection) => collection.ProcessingCenter || collection.ArchiveCenter,
  archiveCenter: () => process.env.ems_provider,
  mission: mission,
  instrument: instrument,
  eosFlag: 'E', // EOS
  productFlag: 1 // Data Product file
};

/**
 * get collections from CMR
 *
 * @returns {Array<Object>} - list of collections containing 'collectionId'
   *   and 'emsRecord' properties
 */
async function getCmrCollections() {
  const collections = [];
  // get all collections from CMR and sort them, since CMR query doesn't support
  // 'version' as sort_key
  const cmrCollectionsIterator = new CMRSearchConceptQueue(
    process.env.cmr_provider, process.env.cmr_client_id, 'collections', [], 'echo10'
  );

  let nextCmrItem = await cmrCollectionsIterator.peek();

  while (nextCmrItem) {
    await cmrCollectionsIterator.shift(); // eslint-disable-line no-await-in-loop

    // evaluate each EMS field based on CMR collection and build EMS record
    const emsRecord = Object.entries(emsMapping)
      // eslint-disable-next-line no-loop-func
      .map(([field, value]) =>
        ({ [field]: (isFunction(value) ? value(nextCmrItem.Collection) : value) }))
      .reduce((returnObj, currentValue) => ({ ...returnObj, ...currentValue }), {});

    const collectionId = constructCollectionId(
      nextCmrItem.Collection.ShortName, nextCmrItem.Collection.VersionId
    );
    const lastUpdate = nextCmrItem.Collection.LastUpdate || nextCmrItem.Collection.InsertTime;
    // console.log('cmrCollection', { collectionId, lastUpdate, emsRecord });
    // if (['A2_SI25_NRT___0', 'MUR-JPL-L4-GLOB-v4.1___1', 'MYD13Q1___006', 'MOD11A1___006']
    //   .includes(collectionId)) {
    //   console.log('writing json file');
    //   fs.writeFileSync(`${collectionId}.json`, JSON.stringify(nextCmrItem));
    // }
    collections.push({ collectionId, lastUpdate, emsRecord });
    nextCmrItem = await cmrCollectionsIterator.peek(); // eslint-disable-line no-await-in-loop
  }

  return collections;
}

const getDbCollections = async () =>
  (await new Collection().getAllCollections())
    .map((collection) => ({
      collectionId: constructCollectionId(collection.name, collection.version),
      lastUpdate: (collection.updatedAt || collection.createdAt)
    }));

/**
 * get collections in both CMR and CUmulus
 *
 * @returns {Array<Object>} list of collections containing 'collectionId'
   *   and 'emsRecord' properties
 * onlyInCmr
 */
async function getCollectionsForEms() {
  // get collections in both CMR and CUMULUS
  //   Get list of collections from CMR
  //   Get list of collections from CUMULUS
  //   Compare collection holdings in CMR and CUMULUS and returns collections in both places

  // get all collections from CMR and sort them, since CMR query doesn't support
  // 'version' as sort_key
  const cmrCollections = sortBy((await getCmrCollections()), ['collectionId']);

  // get all collections from database and sort them, since the scan result is not ordered
  const dbCollections = sortBy((await getDbCollections()), ['collectionId']);
  console.log(dbCollections);

  // collections exist in both CMR and Cumulus
  const emsCollections = [];

  let nextDbCollectionId = (dbCollections.length !== 0) ? dbCollections[0].collectionId : null;
  let nextCmrCollectionId = (cmrCollections.length !== 0) ? cmrCollections[0].collectionId : null;

  while (nextDbCollectionId && nextCmrCollectionId) {
    if (nextDbCollectionId < nextCmrCollectionId) {
      // Found an item that is only in database and not in cmr
      await dbCollections.shift(); // eslint-disable-line no-await-in-loop
    } else if (nextDbCollectionId > nextCmrCollectionId) {
      // Found an item that is only in cmr and not in database
      cmrCollections.shift();
    } else {
      // Found an item that is in both cmr and database
      emsCollections.push(cmrCollections.shift());
      dbCollections.shift();
    }

    nextDbCollectionId = (dbCollections.length !== 0) ? dbCollections[0].collectionId : null;
    nextCmrCollectionId = (cmrCollections.length !== 0) ? cmrCollections[0].collectionId : null;
  }

  console.log('getCollectionsForEms', emsCollections);
  return emsCollections;
}

/**
 * generate an EMS report
 *
 * @param {string} reportType - report type (ingest, archive, delete)
 * @param {string} startTime - start time of the records
 * @param {string} endTime - end time of the records
 * @returns {Object} - report type and its file path {reportType, file}
 */
async function generateReport(reportType, startTime, endTime) {
  log.debug(`ems-ingest-report.generateReport ${reportType} startTime: ${startTime} endTime: ${endTime}`);

  const emsCollections = await getCollectionsForEms();

  const report = emsCollections
    .map((collection) => Object.values(collection.emsRecord).join('|&|'))
    .join('\n');

  const { reportsBucket, reportsPrefix } = bucketsPrefixes();
  const reportKey = await determineReportKey('metadata', startTime, reportsPrefix);

  const s3Uri = buildS3Uri(reportsBucket, reportKey);
  log.info(`Uploading report to ${s3Uri}`);

  return s3().putObject({
    Bucket: reportsBucket,
    Key: reportKey,
    Body: report
  }).promise()
    .then(() => ({ reportType: 'metadata', file: s3Uri }));
}

exports.generateReport = generateReport;

/**
 * cleanup old report files
 */
async function cleanup() {
  log.debug('ems-metadata-report cleanup old reports');

  const { reportsPrefix, reportsSentPrefix } = bucketsPrefixes();
  const jobs = [reportsPrefix, reportsSentPrefix]
    .map((prefix) =>
      getExpiredS3Objects(process.env.system_bucket, prefix, process.env.ems_retentionInDays)
        .then((s3objects) => deleteS3Files(s3objects)));
  return Promise.all(jobs);
}

/**
 * Lambda task, generate and send EMS metadata report
 *
 * @param {Object} event - event passed to lambda
 * @param {string} event.startTime - test only, report startTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.endTime - test only, report endTime in format YYYY-MM-DDTHH:mm:ss
 * @param {Object} context - AWS Lambda context
 * @param {function} callback - callback function
 * @returns {Array<Object>} - list of report type and its file path {reportType, file}
 */
function handler(event, context, callback) {
  // eslint-disable-next-line no-param-reassign
  context.callbackWaitsForEmptyEventLoop = false;

  // increase the limit of search result from CMR.searchCollections/searchGranules
  process.env.CMR_LIMIT = process.env.CMR_LIMIT || 5000;
  process.env.CMR_PAGE_SIZE = process.env.CMR_PAGE_SIZE || 50;

  // 24-hour period ending past midnight
  let endTime = moment.utc().startOf('day').toDate().toUTCString();
  let startTime = moment.utc().subtract(1, 'days').startOf('day').toDate()
    .toUTCString();

  endTime = event.endTime || endTime;
  startTime = event.startTime || startTime;

  return cleanup()
    .then(() => generateReport('metadata', startTime, endTime))
    .then((reports) => submitReports(reports))
    .then((r) => callback(null, r))
    .catch(callback);
}

exports.handler = handler;

process.env.ems_provider = 'CUMULUS';
process.env.CMR_PAGE_SIZE = 1;
process.env.CMR_LIMIT = 1;
process.env.cmr_provider = 'CUMULUS';
process.env.cmr_client_id = 'cumulus-core-jl-test-integration';
process.env.CollectionsTable = 'jl-test-integration-CollectionsTable';
process.env.stackName = 'jl-test-integration';
process.env.system_bucket = 'cumulus-test-sandbox-internal';
process.env.DISTRIBUTION_ENDPOINT = 'https://example.com/';

async function test() {
  return getCollectionsForEms();
}
//test();

// MYD13Q1___006 single ScienceKeywords.ScienceKeyword
//MUR-JPL-L4-GLOB-v4.1___1 single ScienceKeywords.ScienceKeyword, multiple platform and instrument
// A2_SI25_NRT___0 multiple ScienceKeywords.ScienceKeyword.TopicKeyword
// MOD11A1___006 multiple ScienceKeywords.ScienceKeyword
