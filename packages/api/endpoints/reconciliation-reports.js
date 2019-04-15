'use strict';

const router = require('express-promise-router')();
const path = require('path');
const { aws } = require('@cumulus/common');
const { invoke } = require('@cumulus/ingest/aws');

/**
 * List all reconciliation reports
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const constructResultFunc = (fileNames) =>
    ({
      meta: {
        name: 'cumulus-api',
        stack: process.env.stackName
      },
      results: fileNames
    });

  const systemBucket = process.env.system_bucket;
  const key = `${process.env.stackName}/reconciliation-reports/`;
  const fileList = await aws.listS3ObjectsV2({ Bucket: systemBucket, Prefix: key });
  const fileNames = fileList.filter((s3Object) => !s3Object.Key.endsWith(key))
    .map((s3Object) => path.basename(s3Object.Key));
  return res.send(constructResultFunc(fileNames));
}

/**
 * get a reconciliation report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const name = req.params.name;
  const key = `${process.env.stackName}/reconciliation-reports/${name}`;

  try {
    const file = await aws.getS3Object(process.env.system_bucket, key);
    return res.send(JSON.parse(file.Body.toString()));
  } catch (err) {
    if (err.name === 'NoSuchKey') {
      return res.boom.notFound('The report does not exist!');
    }
    throw err;
  }
}

/**
 * delete a reconciliation report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const name = req.params.name;
  const key = `${process.env.stackName}/reconciliation-reports/${name}`;

  await aws.deleteS3Object(process.env.system_bucket, key);
  return res.send({ message: 'Report deleted' });
}

/**
 * Creates a new report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const data = await invoke(process.env.invokeReconcileLambda, {});
  return res.send({ message: 'Report is being generated', status: data.StatusCode });
}

router.get('/:name', get);
router.delete('/:name', del);
router.get('/', list);
router.post('/', post);

module.exports = router;
