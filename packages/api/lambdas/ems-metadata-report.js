'use strict';

const moment = require('moment');
const get = require('lodash.get');
const isFunction = require('lodash.isfunction');
const sortBy = require('lodash.sortby');

const { buildS3Uri, deleteS3Files } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { constructCollectionId } = require('@cumulus/common/collection-config-store');
const log = require('@cumulus/common/log');
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
 *
 * @param {Object} collection - CMR collection object
 * @returns {string} comma-separated discplines
 */
const discipline = (collection) => {
  let scienceKeywords = get(collection, 'ScienceKeywords.ScienceKeyword', []);
  scienceKeywords = (Array.isArray(scienceKeywords))
    ? scienceKeywords : [scienceKeywords];

  return scienceKeywords
    .map((scienceKeyword) => scienceKeyword.TopicKeyword)
    .filter((elem, pos, arr) => arr.indexOf(elem) === pos)
    .join(',');
};

/**
 * Get platforms
 *
 * @param {Object} collection - CMR collection object
 * @returns {Array<Object>} list of platform object
 */
const platforms = (collection) => {
  const platform = get(collection, 'Platforms.Platform', []);
  return Array.isArray(platform) ? platform : [platform];
};

/**
 * Get mission
 *
 * @param {Object} collection - CMR collection object
 * @returns {string} missions separated by semi-colon
 */
const mission = (collection) =>
  platforms(collection).map((platform) => platform.ShortName).join(';');

/**
 * instruments for a platform
 *
 * @param {Object} platform - platform object
 * @returns {string} comma-separated instruments
 */
function buildInstrumentsString(platform) {
  let instruments = get(platform, 'Instruments.Instrument', []);
  instruments = (Array.isArray(instruments)) ? instruments : [instruments];
  return instruments.map((instrument) => instrument.ShortName).join(',');
}

/**
 * instruments for a collection
 *
 * @param {Object} collection - CMR collection object
 * @returns {string} instruments grouped by platform
 */
const instrument = (collection) =>
  platforms(collection)
    .map((platform) => buildInstrumentsString(platform))
    .join(';');

/**
 * map each ems field with CMR collection fields
 */
const emsMapping = {
  product: (collection) => collection.ShortName,
  metaDataLongName: (collection) => collection.DataSetId,
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
 * @returns {Array<Object>} - list of collections containing 'collectionId', 'lastUpdate'
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
    collections.push({ collectionId, lastUpdate, emsRecord });
    nextCmrItem = await cmrCollectionsIterator.peek(); // eslint-disable-line no-await-in-loop
  }

  return collections;
}

/**
 * convert milliseconds elapsed to UTC string
 *
 * @param {number} timeElapsed - milliseconds elapsed since January 1, 1970
 * @returns {string} - datetime string
 */
const millisecondsToUTCString = (timeElapsed) =>
  moment.utc(new Date(timeElapsed)).format();

/**
 * get collections from database
 *
 * @returns {Array<Object>} - list of collections containing 'collectionId',
   *   and 'lastUpdate' properties
 */
const getDbCollections = async () =>
  (await new Collection().getAllCollections())
    .map((collection) => ({
      collectionId: constructCollectionId(collection.name, collection.version),
      reportToEms: get(collection, 'reportToEms', true),
      lastUpdate: millisecondsToUTCString(
        collection.updatedAt || collection.createdAt || Date.now()
      )
    }));

/**
 * get collections in both CMR and CUMULUS
 *
 * @param {string} startTime - start time of the records
 * @param {string} endTime - end time of the records
 *
 * @returns {Array<Object>} list of collections containing 'collectionId', 'lastUpdate',
   *   'dbLastUpdate' and 'emsRecord' properties
 * onlyInCmr
 */
async function getCollectionsForEms(startTime, endTime) {
  // get collections in both CMR and CUMULUS
  //   Get list of collections from CMR
  //   Get list of collections from CUMULUS
  //   Compare collection holdings in CMR and CUMULUS and returns collections in both places

  // get all collections from CMR and sort them, since CMR query doesn't support
  // 'version' as sort_key
  const cmrCollections = sortBy((await getCmrCollections()), ['collectionId']);

  // get all collections from database and sort them, since the scan result is not ordered
  const dbCollections = sortBy((await getDbCollections()), ['collectionId']);

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
      const cmrCollection = cmrCollections.shift();
      const dbCollection = dbCollections.shift();
      if (get(dbCollection, 'reportToEms', true)) {
        emsCollections.push({ ...cmrCollection, dbLastUpdate: dbCollection.lastUpdate });
      }
    }

    nextDbCollectionId = (dbCollections.length !== 0) ? dbCollections[0].collectionId : null;
    nextCmrCollectionId = (cmrCollections.length !== 0) ? cmrCollections[0].collectionId : null;
  }

  // only the collections updated in CMR or CUMULUS within the time range are included
  const lastUpdateFilter = (collection) =>
    (moment.utc(collection.lastUpdate).isBetween(startTime, endTime, null, '[)')
    || moment.utc(collection.dbLastUpdate).isBetween(startTime, endTime, null, '[)'));

  return emsCollections.filter(lastUpdateFilter);
}

/**
 * generate an EMS report
 *
 * @param {string} startTime - start time of the records
 * @param {string} endTime - end time of the records
 * @param {string} collectionId - collectionId of the records if defined
 * @returns {Object} - report type and its file path {reportType, file}
 */
async function generateReport(startTime, endTime, collectionId) {
  log.debug(`ems-metadata-report.generateReport startTime: ${startTime} endTime: ${endTime}`);
  const reportType = 'metadata';

  let emsCollections = await getCollectionsForEms(startTime, endTime);
  if (collectionId) {
    emsCollections = emsCollections
      .filter((collection) => collection.collectionId === collectionId);
  }

  const report = emsCollections
    .map((collection) => Object.values(collection.emsRecord).join('|&|'))
    .join('\n');

  const { reportsBucket, reportsPrefix } = bucketsPrefixes();
  const reportKey = await determineReportKey(reportType, startTime, reportsPrefix);

  const s3Uri = buildS3Uri(reportsBucket, reportKey);
  log.info(`Uploading report to ${s3Uri}`);

  return s3().putObject({
    Bucket: reportsBucket,
    Key: reportKey,
    Body: report
  }).promise()
    .then(() => ({ reportType, file: s3Uri }));
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
 * @param {string} event.startTime - optional, report startTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.endTime - optional, report endTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.collectionId - optional, report collectionId
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
  let endTime = moment.utc().startOf('day').format();
  let startTime = moment.utc().subtract(1, 'days').startOf('day').format();

  // product metadata records don't contain timestamp and don't need to match the
  // datestamp in the filename, there is no need to have separate reports for each day
  endTime = event.endTime || endTime;
  startTime = event.startTime || startTime;

  return cleanup()
    .then(() => generateReport(moment.utc(startTime), moment.utc(endTime), event.collectionId))
    .then((report) => submitReports([report]))
    .then((r) => callback(null, r))
    .catch(callback);
}

exports.handler = handler;
