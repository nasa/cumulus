'use strict';

const fs = require('fs');
const flatten = require('lodash.flatten');
const moment = require('moment');
const os = require('os');
const path = require('path');
const { aws, log } = require('@cumulus/common');
const {
  buildReportFileName,
  buildStartEndTimes,
  determineReportKey,
  determineReportsStartEndTime,
  getEmsEnabledCollections,
  getExpiredS3Objects,
  reportToFileType,
  submitReports
} = require('../lib/ems');
const { deconstructCollectionId } = require('../lib/utils');
const { Search, defaultIndexAlias } = require('../es/search');

/**
 * This module provides functionalities to generate EMS reports.
 * The following environment variables are used:
 * process.env.ES_SCROLL_SIZE: default to defaultESScrollSize
 * process.env.ES_INDEX: set for testing purpose, default to defaultIndexAlias
 * process.env.ems_provider: default to 'cumulus', the provider used for sending reports to EMS
 * process.env.ems_submitReport: default to 'false', indicates if the reports will be sent to EMS
 * process.env.ems_host: EMS host
 * process.env.ems_port: EMS host port
 * process.env.ems_path: EMS host directory path for reports
 * process.env.ems_username: the username used for sending reports to EMS
 * process.env.ems_privateKey: default to 'ems.private.pem', the private key file used for sending
 *   reports to EMS. privateKey filename in s3://system_bucket/stackName/crypto
 * process.env.ems_dataSource: the data source of EMS reports
 * process.env.ems_retentionInDays: the retention in days for reports and s3 server access logs
 * process.env.stackName: it's used as part of the report filename
 * process.env.system_bucket: the bucket to store the generated reports and s3 server access logs
 */

const defaultESScrollSize = 1000;

const bucketsPrefixes = () => ({
  reportsBucket: process.env.system_bucket,
  reportsPrefix: `${process.env.stackName}/ems/`,
  reportsSentPrefix: `${process.env.stackName}/ems/sent/`
});
exports.bucketsPrefixes = bucketsPrefixes;

/**
 * For each EMS ingest report type (ingest, archive, delete),
 * map the EMS fields to CUMULUS granule/deletedgranule record fields,
 */
const emsMappings = {
  ingest: {
    dbID: 'granuleId',
    product: 'collectionId', // shortName part
    productVolume: 'productVolume',
    productState: 'status',
    externalDataProvider: 'provider',
    processingStartDateTime: 'processingStartDateTime',
    processingEndDateTime: 'processingEndDateTime',
    timeToArchive: 'timeToArchive',
    timeToPreprocess: 'timeToPreprocess',
    timeToXfer: 'duration'
  },

  archive: {
    dbID: 'granuleId',
    product: 'collectionId', // shortName part
    productVolume: 'productVolume',
    totalFiles: 'files', // total # files
    insertTime: 'createdAt',
    beginningDateTime: 'beginningDateTime',
    endingDateTime: 'endingDateTime',
    productionDateTime: 'productionDateTime',
    localGranuleID: 'granuleId',
    versionID: 'collectionId', // versionID part
    // since we have separate 'delete' report,
    // deleteFromArchive shall have value 'N', deleteEffectiveDate shall be left blank
    deleteFromArchive: 'deleteFromArchive', // N
    deleteEffectiveDate: 'deleteEffectiveDate', // null
    lastUpdate: 'lastUpdateDateTime'
  },

  delete: {
    dbID: 'granuleId',
    deleteEffectiveDate: 'deletedAt'
  }
};

/**
 * build and elasticsearch query parameters
 *
 * @param {string} esIndex - es index to search on
 * @param {string} type - es document type to search on
 * @param {string} startTime - startTime of the records
 * @param {string} endTime - endTime of the records
 * @returns {Object} query parameters
 */
function buildSearchQuery(esIndex, type, startTime, endTime) {
  // types are 'granule' or 'deletedgranule'
  const timeFieldName = (type === 'granule') ? 'createdAt' : 'deletedAt';
  const params = {
    index: esIndex,
    type: type,
    scroll: '30s',
    size: process.env.ES_SCROLL_SIZE || defaultESScrollSize,
    body: {
      query: {
        bool: {
          must: [
            {
              range: {
                [`${timeFieldName}`]: {
                  gte: moment.utc(startTime).toDate().getTime(),
                  lt: moment.utc(endTime).toDate().getTime()
                }
              }
            },
            {
              terms: {
                // filter out 'running' status
                status: ['failed', 'completed']
              }
            }]
        }
      }
    }
  };
  if (type === 'deletedgranule') params._source = ['granuleId', 'collectionId', 'deletedAt'];
  return params;
}

/**
 * upload a report to s3, a rev file is created if the report already exists in s3
 *
 * @param {string} filename - file to be upload to s3
 * @param {string} reportBucket - s3 report bucket
 * @param {string} reportKey - s3 report key
 * @returns {string} - uploaded file in s3
 */
async function uploadReportToS3(filename, reportBucket, reportKey) {
  await aws.s3().putObject({
    Bucket: reportBucket,
    Key: reportKey,
    Body: fs.createReadStream(filename)
  }).promise();

  fs.unlinkSync(filename);
  const s3Uri = aws.buildS3Uri(reportBucket, reportKey);
  log.info(`uploaded ${s3Uri}`);
  return s3Uri;
}

/**
 * get the value of EMS record field from corresponding field of the  granule record
 *
 * @param {Object} granule - es granule record
 * @param {string} emsField - EMS field
 * @param {string} granField - granule field
 * @returns {string} granule metadata for EMS
 */
function getEmsFieldFromGranField(granule, emsField, granField) {
  const metadata = granule[granField];
  let result = metadata;
  switch (emsField) {
  case 'product':
    result = deconstructCollectionId(metadata).name;
    break;
  case 'versionID':
    result = parseInt(deconstructCollectionId(metadata).version, 10);
    break;
  case 'deleteFromArchive':
    result = 'N';
    break;
  case 'totalFiles':
    result = (metadata) ? metadata.length : 0;
    break;
  case 'productState':
    result = (metadata === 'completed') ? 'Successful' : 'Failed';
    break;
  // datetime format YYYYMMDD
  case 'deleteEffectiveDate':
    // milliseconds to string
    result = (metadata) ? moment.utc(new Date(metadata)).format('YYYYMMDD') : metadata;
    break;
  // datetime format YYYY-MM-DD HH:MMAMorPM
  case 'insertTime':
    // milliseconds to string
    result = (metadata) ? moment.utc(new Date(metadata)).format('YYYY-MM-DD hh:mmA') : metadata;
    break;
  case 'lastUpdate':
  case 'processingStartDateTime':
  case 'processingEndDateTime':
  case 'beginningDateTime':
  case 'endingDateTime':
  case 'productionDateTime':
    // string to different format string
    result = (metadata) ? moment.utc(Date.parse(metadata)).format('YYYY-MM-DD hh:mmA') : metadata;
    break;
  default:
    break;
  }
  return result;
}


/**
 * build EMS records from es granules
 *
 * @param {Object} mapping - mapping of EMS fields to granule fields
 * @param {Object} granules - es granules
 * @param {Array<string>} collections - list of EMS enabled collections
 * @returns {Array<string>} EMS records
 */
function buildEMSRecords(mapping, granules, collections) {
  const records = granules
    .filter((granule) => collections.includes(granule.collectionId))
    .map((granule) => {
      const record = Object.keys(mapping)
        .map((emsField) => getEmsFieldFromGranField(granule, emsField, mapping[emsField]));
      return record.join('|&|');
    });
  return records;
}

/**
 * generate an EMS report
 *
 * @param {string} reportType - report type (ingest, archive, delete)
 * @param {string} startTime - start time of the records
 * @param {string} endTime - end time of the records
 * @param {Array<string>} collections - list of EMS enabled collections
 * @returns {Object} - report type and its file path {reportType, file}
 */
async function generateReport(reportType, startTime, endTime, collections) {
  log.debug(`ems-ingest-report.generateReport ${reportType} startTime: ${startTime} endTime: ${endTime}`);

  if (!Object.keys(emsMappings).includes(reportType)) {
    throw new Error(`ems-ingest-report.generateReport report type not supported: ${reportType}`);
  }

  // create a temporary file for the report
  const name = buildReportFileName(reportType, startTime);
  const filename = path.join(os.tmpdir(), name);
  const stream = fs.createWriteStream(filename);

  // retrieve granule/deletedgranule records in batches, and generate EMS records for each batch
  const esClient = await Search.es();
  const type = (reportType !== 'delete') ? 'granule' : 'deletedgranule';

  const esIndex = process.env.ES_INDEX || defaultIndexAlias;
  const searchQuery = buildSearchQuery(esIndex, type, startTime, endTime);
  let response = await esClient.search(searchQuery);
  let granules = response.hits.hits.map((s) => s._source);
  let records = buildEMSRecords(emsMappings[reportType], granules, collections);
  stream.write(records.length ? records.join('\n') : '');
  let numRetrieved = granules.length;
  let numRecords = records.length;

  while (response.hits.total !== numRetrieved) {
    response = await esClient.scroll({ // eslint-disable-line no-await-in-loop
      scrollId: response._scroll_id,
      scroll: '30s'
    });
    granules = response.hits.hits.map((s) => s._source);
    records = buildEMSRecords(emsMappings[reportType], granules, collections);
    stream.write(records.length ? `\n${records.join('\n')}` : '');
    numRetrieved += granules.length;
    numRecords += records.length;
  }
  stream.end();
  log.debug(`EMS ${reportType} generated with ${numRecords} records from ${numRetrieved} granules: ${filename}`);

  // upload to s3
  const reportKey = await determineReportKey(
    reportType, startTime, bucketsPrefixes().reportsPrefix
  );
  const s3Uri = await uploadReportToS3(filename, process.env.system_bucket, reportKey);
  return { reportType, file: s3Uri };
}

/**
 * generate all EMS reports given the time range of the records
 *
 * @param {Object} params - params
 * @param {string} params.startTime - start time of the reports in format YYYY-MM-DDTHH:mm:ss
 * @param {string} params.endTime - end time of the reports in format YYYY-MM-DDTHH:mm:ss
 * @param {string} params.emsCollections - optional, collectionIds of the records
 * @returns {Array<Object>} - list of report type and its file path {reportType, file}
 */
async function generateReports(params) {
  const collections = params.emsCollections || await getEmsEnabledCollections();
  return Promise.all(Object.keys(emsMappings)
    .map((reportType) => generateReport(
      reportType, params.startTime, params.endTime, collections
    )));
}

/**
 * generate all EMS reports for each day given the date time range of the reports
 *
 * @param {Object} params - params
 * @param {string} params.startTime - start time of the reports in format YYYY-MM-DDTHH:mm:ss
 * @param {string} params.endTime - end time of the reports in format YYYY-MM-DDTHH:mm:ss
 * @param {string} params.collectionId - collectionId of the records if defined
 * @returns {Array<Object>} - list of report type and its file path {reportType, file}
 */
async function generateReportsForEachDay(params) {
  log.info(`ems-ingest-report.generateReportsForEachDay for access records between ${params.startTime} and ${params.endTime}`);

  const {
    reportStartTime,
    reportEndTime
  } = determineReportsStartEndTime(params.startTime, params.endTime);

  // ICD Section 3.4 Data Files Interface section describes that each file should contain one day's
  // worth of data. Data within the file will correspond to the datestamp in the filename.
  // Exceptions to this rule include Ingest data where processingEndDateTime could be after
  // the datestamp.

  // The updated ingest and archive data flat files only need to contain the corrected records.
  // Previous records will be updated and/or appended (i.e., merged) with revision file content.

  let emsCollections = await getEmsEnabledCollections();
  const collectionId = params.collectionId;
  if (collectionId) {
    emsCollections = (emsCollections.includes(collectionId)) ? [collectionId] : [];
  }

  // no report should be generated if the collection is not EMS enabled
  if (emsCollections.length === 0) {
    return [];
  }

  // each startEndTimes element represents one day
  const startEndTimes = buildStartEndTimes(reportStartTime, reportEndTime);

  return flatten(await Promise.all(startEndTimes.map((startEndTime) =>
    generateReports({ ...startEndTime, emsCollections }))));
}

/**
 * cleanup old reports
 */
async function cleanup() {
  log.debug('ems-ingest-report cleanup old reports');

  // report key must match ingest file types such as _Ing_ etc.
  const matches = Object.keys(emsMappings).map((reportType) => `_${reportToFileType(reportType)}_`).join('|');

  const { reportsBucket, reportsPrefix, reportsSentPrefix } = bucketsPrefixes();
  const jobs = [reportsPrefix, reportsSentPrefix]
    .map((prefix) =>
      getExpiredS3Objects(reportsBucket, prefix, process.env.ems_retentionInDays)
        .then((s3objects) => s3objects.filter((s3object) => s3object.Key.match(`(${matches})`)))
        .then((s3objects) => aws.deleteS3Files(s3objects)));
  return Promise.all(jobs);
}


/**
 * Lambda task, generate and send EMS ingest reports
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
  // 24-hour period ending past midnight
  let endTime = moment.utc().startOf('day').format();
  let startTime = moment.utc().subtract(1, 'days').startOf('day').format();

  endTime = event.endTime || endTime;
  startTime = event.startTime || startTime;

  // catch up run to generate reports for each day
  if (event.startTime && event.endTime) {
    return generateReportsForEachDay({ startTime, endTime, collectionId: event.collectionId })
      .then((reports) => submitReports(reports))
      .then((r) => callback(null, r))
      .catch(callback);
  }

  // daily report generation
  return cleanup()
    .then(() => generateReports({ startTime, endTime }))
    .then((reports) => submitReports(reports))
    .then((r) => callback(null, r))
    .catch(callback);
}

module.exports = {
  emsMappings,
  generateReports,
  generateReportsForEachDay,
  handler
};
