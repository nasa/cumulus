/* eslint-disable no-param-reassign */

'use strict';

const _get = require('lodash.get');
const path = require('path');
const { inTestMode } = require('@cumulus/common/test-utils');
const { aws, log } = require('@cumulus/common');
const { invoke } = require('@cumulus/ingest/aws');
const handle = require('../lib/response').handle;

/**
 * List all reconciliation reports
 *
 * @param {Object} event - aws lambda event object.
 * @param {function} cb - aws lambda callback function
 * @returns {Array} - list of reports
 */
function list(event, cb) {
  const systemBucket = process.env.system_bucket;
  const key = `${process.env.stackName}/reconciliation-reports/`;
  return aws.listS3ObjectsV2({ Bucket: systemBucket, Prefix: key })
    .then((fileList) => fileList.map((s3Object) => path.basename(s3Object.Key)))
    .then((s3Objects) => cb(null, s3Objects))
    .catch((err) => {
      log.error(`reconciliation-reports.list caught error ${err.stack}`);
      return cb(err);
    });
}

/**
 * get a reconciliation report
 *
 * @param {Object} event - event passed to lambda
 * @param {function} cb - aws lambda callback function
 * @returns {Object} a granule reconciliation report
 */
function get(event, cb) {
  const name = _get(event.pathParameters, 'name');
  const key = `${process.env.stackName}/reconciliation-reports/${name}`;

  return aws.getS3Object(process.env.system_bucket, key)
    .then((file) => cb(null, file.Body.toString()))
    .catch((err) => cb(err));
}

/**
 * delete a reconciliation report
 *
 * @param {Object} event - event passed to lambda
 * @param {function} cb - aws lambda callback function
 * @returns {Object} a granule reconciliation report
 */
function del(event, cb) {
  const name = _get(event.pathParameters, 'name');
  const key = `${process.env.stackName}/reconciliation-reports/${name}`;

  return aws.deleteS3Object(process.env.system_bucket, key)
    .then(() => cb(null, { message: 'Report deleted' }))
    .catch((err) => cb(err));
}

/**
 * Creates a new report
 *
 * @param {Object} event - event passed to lambda
 * @param {function} cb - aws lambda callback function
 * @returns {Object} returns the report generated
 */
function post(event, cb) {
  const params = {
    buckets: Object.keys(process.env.buckets).map((bucket) => process.env.buckets[bucket].name),
    filesTableName: process.env.FilesTable
  };
  return invoke(process.env.invoke, params)
    .then((data) => cb(null, { message: 'Report generated', report: data }))
    .catch((err) => cb(err));
}

/**
 * a lambda function for handling requests of reconciliation reports
 *
 * @param {Object} event - an AWS Lambda event
 * @param {Object} context - an AWS Lambda context
 * @returns {Promise} - list of report type and its file path {reportType, file}
 */
function handler(event, context) {
  return handle(event, context, !inTestMode() /* authCheck */, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      get(event, cb);
    }
    else if (event.httpMethod === 'POST') {
      post(event, cb);
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      del(event, cb);
    }
    else {
      list(event, cb);
    }
  });
}

module.exports = handler;
