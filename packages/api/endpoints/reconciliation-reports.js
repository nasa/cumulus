'use strict';

const router = require('express-promise-router')();
const {
  deleteS3Object,
  fileExists,
  getObjectSize,
  getS3Object,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');

const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const asyncOperations = require('@cumulus/async-operations');
const Logger = require('@cumulus/logger');

const models = require('../models');
const { normalizeEvent } = require('../lib/reconciliationReport/normalizeEvent');
const { Search } = require('../es/search');
const indexer = require('../es/indexer');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');

const logger = new Logger({ sender: '@cumulus/api' });
const maxResponsePayloadSize = 6 * 1024 * 1024;

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
    const reportExists = await fileExists(Bucket, Key);
    if (!reportExists) {
      return res.boom.notFound('The report does not exist!');
    }

    const downloadFile = Key.split('/').pop();
    const presignedS3Url = s3().getSignedUrl('getObject', {
      Bucket, Key, ResponseContentDisposition: `attachment; filename="${downloadFile}"`,
    });

    if (Key.endsWith('.json') || Key.endsWith('.csv')) {
      const reportSize = await getObjectSize({ s3: s3(), bucket: Bucket, key: Key });
      // estimated payload size, add extra
      const estimatedPayloadSize = presignedS3Url.length + reportSize + 50;
      if (estimatedPayloadSize > (process.env.maxResponsePayloadSize || maxResponsePayloadSize)) {
        res.json({
          presignedS3Url,
          data: `Error: Report ${name} exceeded maximum allowed payload size`,
        });
      } else {
        const file = await getS3Object(Bucket, Key);
        logger.debug(`Sending json file with contentLength ${file.ContentLength}`);
        return res.json({
          presignedS3Url,
          data: Key.endsWith('.json') ? JSON.parse(file.Body.toString()) : file.Body.toString(),
        });
      }
    }
    logger.debug('reconciliation report getReport received an unhandled report type.');
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${name}`);
    }
    throw error;
  }
  return res.boom.badImplementation('reconciliation report getReport failed in an indeterminate manner.');
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
      ignore: [404],
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
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const tableName = process.env.AsyncOperationsTable;
  let validatedInput;
  try {
    validatedInput = normalizeEvent(req.body);
  } catch (error) {
    logger.error(error);
    return res.boom.badRequest(error.message, error);
  }

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    lambdaName: process.env.invokeReconcileLambda,
    description: 'Create Reconciliation Report',
    operationType: 'Reconciliation Report',
    payload: validatedInput,
    useLambdaEnvironmentVariables: true,
    stackName,
    systemBucket,
    dynamoTableName: tableName,
    knexConfig: process.env,
  }, models.AsyncOperation);

  return res.status(202).send(asyncOperation);
}

router.get('/:name', getReport);
router.delete('/:name', deleteReport);
router.get('/', listReports);
router.post('/', createReport, asyncOperationEndpointErrorHandler);

module.exports = router;
