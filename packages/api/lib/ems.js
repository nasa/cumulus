'use strict';

const get = require('lodash.get');
const moment = require('moment');
const path = require('path');
const {
  s3Join,
  listS3ObjectsV2,
  parseS3Uri,
  s3CopyObject,
  buildS3Uri
} = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');
const { constructCollectionId } = require('@cumulus/common');
const { Sftp } = require('@cumulus/common/sftp');
const { Collection } = require('../models');

/**
 * return fileType based on report type
 *
 * @param {string} reportType - report type
 * @returns {string} fileType used as part of the report file name
 */
const reportToFileType = (reportType) => {
  const type = {
    ingest: 'Ing',
    archive: 'Arch',
    delete: 'ArchDel',
    distribution: 'DistCustom',
    metadata: 'Meta'
  };
  return type[reportType];
};

/**
 * build report file name
 * The report filename is in format:
 * <YYYYMMDD> _<Provider>_<FileType>_<DataSource>.flt.rev<1-n>
 *
 * @param {string} reportType - report type (ingest, archive, delete, distribution, metadata etc.)
 * @param {string} startTime - start time of the report in a format that moment
 *   can parse
 * @returns {string} - report file name
 */
function buildReportFileName(reportType, startTime) {
  // DataSource: designates the database table name or data source file/table name
  // use stackname as DataSource for now
  const provider = process.env.ems_provider || 'cumulus';
  const dataSource = process.env.ems_dataSource || process.env.stackName;
  const datestring = moment.utc(startTime).format('YYYYMMDD');
  const fileType = reportToFileType(reportType);
  return `${datestring}_${provider}_${fileType}_${dataSource}.flt`;
}

/**
 * Determine the S3 key where the report should be stored
 *
 * @param {string} reportType - report type (ingest, archive, delete, distribution, metadata etc.)
 * @param {string} reportStartTime - the timestamp of the report in a format that moment can parse
 * @param {string} reportsPrefix - the S3 prefix where the reports are located
 *
 * @returns {string} the S3 key where the report should be stored
 */
async function determineReportKey(reportType, reportStartTime, reportsPrefix) {
  let reportName = buildReportFileName(reportType, reportStartTime);

  const revisionNumber = (await listS3ObjectsV2({
    Bucket: process.env.system_bucket,
    Prefix: s3Join([reportsPrefix, reportName])
  })).length;

  if (revisionNumber > 0) reportName = `${reportName}.rev${revisionNumber}`;

  return s3Join([reportsPrefix, reportName]);
}

/**
 * get list of EMS enabled collections from database
 *
 * @returns {Array<string>} - list of collectionIds
 */
const getEmsEnabledCollections = async () =>
  (await new Collection().getAllCollections())
    .filter((collection) => get(collection, 'reportToEms', true))
    .map((collection) => constructCollectionId(collection.name, collection.version));

/**
 * get list of expired s3 objects
 * @param {string} bucket - the s3 bucket
 * @param {string} prefix - the S3 prefix where the objects are located
 * @param {string} retentionInDays - the retention in days for the s3 objects
 * @returns {Array<Object>} - list of s3 objects
 */
async function getExpiredS3Objects(bucket, prefix, retentionInDays) {
  const retentionFilter = (s3Object) =>
    s3Object.LastModified.getTime() <= moment.utc().subtract(retentionInDays, 'days').toDate().getTime();

  return (await listS3ObjectsV2({ Bucket: bucket, Prefix: prefix }))
    .filter(retentionFilter)
    .filter((s3Object) => !s3Object.Key.endsWith('/'))
    .map((s3Object) => ({ Bucket: bucket, Key: s3Object.Key }));
}

/**
 * submit reports to ems
 *
 * @param {Array<Object>} reports - list of report type and its s3 file path {reportType, file}
 * @returns {Array<Object>} - list of report type and its s3 file path {reportType, file}
 */
async function submitReports(reports) {
  const emsConfig = {
    username: process.env.ems_username,
    host: process.env.ems_host,
    port: process.env.ems_port,
    privateKey: process.env.ems_privateKey || 'ems-private.pem',
    submitReport: process.env.ems_submitReport === 'true' || false
  };

  if (!emsConfig.submitReport) {
    log.debug('EMS reports are not configured to be sent');
    return reports;
  }

  const reportsSent = [];
  const sftpClient = new Sftp(emsConfig);

  // submit files one by one using the same connection
  for (let i = 0; i < reports.length; i += 1) {
    const parsed = parseS3Uri(reports[i].file);
    const keyfields = parsed.Key.split('/');
    const fileName = keyfields.pop();
    // eslint-disable-next-line no-await-in-loop
    await sftpClient.syncFromS3(
      { Bucket: parsed.Bucket, Key: parsed.Key },
      path.join(process.env.ems_path || '', fileName).replace(/^\/+/g, '')
    );
    log.debug(`EMS report ${fileName} is sent`);

    // copy to sent folder, the file is also in original location so that a .rev file
    // can be generated
    const newKey = path.join(keyfields.join('/'), 'sent', fileName);

    // eslint-disable-next-line no-await-in-loop
    await s3CopyObject({
      CopySource: `${parsed.Bucket}/${parsed.Key}`,
      Bucket: parsed.Bucket,
      Key: newKey
    });

    reportsSent.push({
      reportType: reports[i].reportType,
      file: buildS3Uri(parsed.Bucket, newKey)
    });
  }

  await sftpClient.end();
  return reportsSent;
}

/**
 * determine actual reports' start and end time given the time range
 *
 * @param {string} startTime - start time of the reports
 * @param {string} endTime - end time of the reports
 * @returns {Object.<moment, moment>} report start and end time {reportStartTime, reportEndTime}
 */
function determineReportsStartEndTime(startTime, endTime) {
  // the reports start at the beginning of the day (inclusive)
  // and end at the beginning of the another day (exclusive)
  const nextDate = moment.utc().add(1, 'days').startOf('day').format();
  const reportStartTime = moment.utc(startTime).startOf('day');
  let reportEndTime = moment.utc(endTime).startOf('day');
  reportEndTime = (reportEndTime.isAfter(nextDate)) ? nextDate : reportEndTime;
  return ({ reportStartTime, reportEndTime });
}

/**
 * build list of objects representing start and end time of each day
 *
 * @param {moment} reportStartTime - the beginning of the day reports start (inclusive)
 * @param {moment} reportEndTime - the beginning of the day reports end (exclusive)
 * @returns {Array<Object.<string, string>>} list of objects including {startTime, endTime}
 */
function buildStartEndTimes(reportStartTime, reportEndTime) {
  // each startEndTimes element represents one day
  const startEndTimes = [];
  while (reportStartTime.isBefore(reportEndTime)) {
    startEndTimes.push({
      startTime: moment(reportStartTime).format(),
      endTime: moment(reportStartTime).add(1, 'days').format()
    });
    reportStartTime.add(1, 'days');
  }
  return startEndTimes;
}

module.exports = {
  buildReportFileName,
  buildStartEndTimes,
  determineReportKey,
  determineReportsStartEndTime,
  getEmsEnabledCollections,
  getExpiredS3Objects,
  submitReports,
  reportToFileType
};
