'use strict';

const router = require('express-promise-router')();
const {
  deleteS3Object,
  getS3Object,
  fileExists,
  parseS3Uri
} = require('@cumulus/aws-client/S3');
const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');

const models = require('../models');
const { Search } = require('../es/search');
const indexer = require('../es/indexer');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');

/**
 * List all reconciliation reports
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function listReports(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'reconciliationReport',
    process.env.ES_INDEX
  );

  const response = await search.query();
  return res.send(response);
}

/**
 * get a reconciliation report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function getReport(req, res) {
  const name = req.params.name;
  const reconciliationReportModel = new models.ReconciliationReport();

  try {
    const result = await reconciliationReportModel.get({ name });
    const { Bucket, Key } = parseS3Uri(result.location);
    const file = await getS3Object(Bucket, Key);
    return res.send(JSON.parse(file.Body.toString()));
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${name}`);
    }
    if (error.name === 'NoSuchKey') {
      return res.boom.notFound('The report does not exist!');
    }
    throw error;
  }
}

/**
 * delete a reconciliation report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function deleteReport(req, res) {
  const name = req.params.name;
  const reconciliationReportModel = new models.ReconciliationReport();
  const record = await reconciliationReportModel.get({ name });

  const { Bucket, Key } = parseS3Uri(record.location);
  if (await fileExists(Bucket, Key)) {
    await deleteS3Object(Bucket, Key);
  }
  await reconciliationReportModel.delete({ name });

  if (inTestMode()) {
    const esClient = await Search.es(process.env.ES_HOST);
    await indexer.deleteRecord({
      esClient,
      id: name,
      type: 'reconciliationReport',
      index: process.env.ES_INDEX,
      ignore: [404]
    });
  }

  return res.send({ message: 'Report deleted' });
}

/**
 * Creates a new report
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function createReport(req, res) {
  const startTimestamp = req.body.startTimestamp || undefined;
  const endTimestamp = req.body.endTimestamp || undefined;
  const payload = { startTimestamp, endTimestamp };

  const asyncOperationModel = new models.AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });

  const asyncOperation = await asyncOperationModel.start({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    lambdaName: process.env.invokeReconcileLambda,
    description: 'Create Inventory Report',
    operationType: 'Reconciliation Report',
    payload,
    useLambdaEnvironmentVariables: true
  });

  return res.status(202).send(asyncOperation);
}

router.get('/:name', getReport);
router.delete('/:name', deleteReport);
router.get('/', listReports);
router.post('/', createReport, asyncOperationEndpointErrorHandler);

module.exports = router;
