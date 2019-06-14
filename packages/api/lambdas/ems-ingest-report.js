'use strict';

const fs = require('fs');
const moment = require('moment');
const os = require('os');
const path = require('path');
const { aws, log } = require('@cumulus/common');
const {
  buildReportFileName, determineReportKey, getExpiredS3Objects, reportToFileType, submitReports
} = require('../lib/ems');
const { deconstructCollectionId } = require('../es/indexer');
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
  if (type === 'deletedgranule') params._source = ['granuleId', 'deletedAt'];
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
  // deleteEffectiveDate format YYYYMMDD
  case 'deleteEffectiveDate':
    result = (metadata) ? moment.utc(new Date(metadata)).format('YYYYMMDD') : metadata;
    break;
  // datetime format YYYY-MM-DD HH:MMAMorPM GMT
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
 * @returns {Array<string>} EMS records
 */
function buildEMSRecords(mapping, granules) {
  const records = granules.map((granule) => {
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
 * @returns {Object} - report type and its file path {reportType, file}
 */
async function generateReport(reportType, startTime, endTime) {
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
  let numRetrieved = granules.length;
  stream.write(buildEMSRecords(emsMappings[reportType], granules).join('\n'));

  while (response.hits.total !== numRetrieved) {
    response = await esClient.scroll({ // eslint-disable-line no-await-in-loop
      scrollId: response._scroll_id,
      scroll: '30s'
    });
    granules = response.hits.hits.map((s) => s._source);
    stream.write('\n');
    stream.write(buildEMSRecords(emsMappings[reportType], granules).join('\n'));
    numRetrieved += granules.length;
  }
  stream.end();
  log.debug(`EMS ${reportType} generated with ${numRetrieved} records: ${filename}`);

  // upload to s3
  const reportKey = await determineReportKey(
    reportType, startTime, bucketsPrefixes().reportsPrefix
  );
  const s3Uri = await uploadReportToS3(filename, process.env.system_bucket, reportKey);
  return { reportType, file: s3Uri };
}

/**
 * generate all EMS reports given the time range of the records and submit to ems
 *
 * @param {string} startTime - start time of the records
 * @param {string} endTime - end time of the records
 * @returns {Array<Object>} - list of report type and its file path {reportType, file}
 */
async function generateReports(startTime, endTime) {
  return Promise.all(Object.keys(emsMappings)
    .map((reportType) => generateReport(reportType, startTime, endTime)));
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
 * @param {string} event.startTime - test only, report startTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.endTime - test only, report endTime in format YYYY-MM-DDTHH:mm:ss
 * @param {string} event.report - test only, s3 uri of the report to be sent
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

  if (event.report) {
    return submitReports([{ reportType: 'ingest', file: event.report }])
      .then((r) => callback(null, r))
      .catch(callback);
  }

  return cleanup()
    .then(() => generateReports(startTime, endTime))
    .then((reports) => submitReports(reports))
    .then((r) => callback(null, r))
    .catch(callback);
}

module.exports = {
  emsMappings,
  generateReports,
  handler
};
