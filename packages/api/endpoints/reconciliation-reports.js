//@ts-check

'use strict';

const router = require('express-promise-router')();
const { v4: uuidv4 } = require('uuid');
const {
  deleteS3Object,
  fileExists,
  getObjectSize,
  getObject,
  parseS3Uri,
  buildS3Uri,
  getObjectStreamContents,
} = require('@cumulus/aws-client/S3');
const S3ObjectStore = require('@cumulus/aws-client/S3ObjectStore');
const { s3 } = require('@cumulus/aws-client/services');

const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const { ReconciliationReportSearch } = require('@cumulus/db');

const {
  ReconciliationReportPgModel,
  createRejectableTransaction,
  getKnexClient,
} = require('@cumulus/db');
const { normalizeEvent } = require('../lib/reconciliationReport/normalizeEvent');
const startAsyncOperation = require('../lib/startAsyncOperation');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const { getFunctionNameFromRequestContext } = require('../lib/request');

const logger = new Logger({ sender: '@cumulus/api' });
const maxResponsePayloadSizeBytes = 6 * 1000 * 1000;

/**
* @typedef {import('../lib/types').NormalizedRecReportParams} NormalizedRecReportParams
* @typedef {import('../lib/types').RecReportParams} RecReportParams
*/

/**
 * List all reconciliation reports
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function listReports(req, res) {
  const dbSearch = new ReconciliationReportSearch(
    { queryStringParameters: req.query }
  );
  const result = await dbSearch.query();
  return res.send(result);
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

  try {
    const reconciliationReportPgModel = new ReconciliationReportPgModel();
    const knex = await getKnexClient();
    const result = await reconciliationReportPgModel.get(knex, { name });
    if (!result.location) {
      return res.boom.badRequest('The reconciliation report record does not contain a location.');
    }
    const { Bucket, Key } = parseS3Uri(result.location);
    const reportExists = await fileExists(Bucket, Key);
    if (!reportExists) {
      return res.boom.notFound('The report does not exist!');
    }

    const downloadFile = Key.split('/').pop();
    const s3ObjectStoreClient = new S3ObjectStore();
    const s3ObjectUrl = buildS3Uri(Bucket, Key);
    const presignedS3Url = await s3ObjectStoreClient.signGetObject(
      s3ObjectUrl,
      {
        ResponseContentDisposition: `attachment; filename="${downloadFile}"`,
      }
    );

    if (Key.endsWith('.json') || Key.endsWith('.csv')) {
      const reportSize = await getObjectSize({ s3: s3(), bucket: Bucket, key: Key }) ?? 0;
      // estimated payload size, add extra
      const estimatedPayloadSize = presignedS3Url.length + reportSize + 50;
      if (estimatedPayloadSize >
        Number(process.env.maxResponsePayloadSizeBytes || maxResponsePayloadSizeBytes)
      ) {
        res.json({
          presignedS3Url,
          data: `Error: Report ${name} exceeded maximum allowed payload size`,
        });
      } else {
        const file = await getObject(s3(), { Bucket, Key });
        logger.debug(`Sending json file with contentLength ${file.ContentLength}`);
        if (!file.Body) {
          return res.boom.badRequest('Report file does not have a body.');
        }
        const fileBody = await getObjectStreamContents(file.Body);
        return res.json({
          presignedS3Url,
          data: Key.endsWith('.json') ? JSON.parse(fileBody) : fileBody,
        });
      }
    }
    logger.debug('Reconciliation report getReport received an unhandled report type.');
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${name}`);
    }
    throw error;
  }

  return res.boom.badImplementation('Reconciliation report getReport failed in an indeterminate manner.');
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
  let record;

  const reconciliationReportPgModel = new ReconciliationReportPgModel();
  const knex = await getKnexClient();
  try {
    record = await reconciliationReportPgModel.get(knex, { name });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${name}`);
    }
    throw error;
  }

  if (!record.location) {
    return res.boom.badRequest('The reconciliation report record does not contain a location!');
  }
  const { Bucket, Key } = parseS3Uri(record.location);

  await createRejectableTransaction(knex, async () => {
    if (await fileExists(Bucket, Key)) {
      await deleteS3Object(Bucket, Key);
    }
    await reconciliationReportPgModel.delete(knex, { name });
  });

  return res.send({ message: 'Report deleted' });
}

/**
 * Creates a new report
 *
 * @param {Object} req - express request object
 * @param {RecReportParams} req.body
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function createReport(req, res) {
  /** @type NormalizedRecReportParams */
  let validatedInput;
  try {
    validatedInput = normalizeEvent(req.body);
  } catch (error) {
    logger.error(error);
    return res.boom.badRequest(error.message, error);
  }

  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.invokeReconcileLambda,
    description: 'Create Reconciliation Report',
    operationType: 'Reconciliation Report',
    payload: validatedInput,
  };

  logger.debug(`About to invoke lambda to start async operation ${asyncOperationId}`);
  await startAsyncOperation.invokeStartAsyncOperationLambda(asyncOperationEvent);
  return res.status(202).send({ id: asyncOperationId });
}

router.get('/:name', getReport);
router.delete('/:name', deleteReport);
router.get('/', listReports);
router.post('/', createReport, asyncOperationEndpointErrorHandler);

module.exports = {
  createReport,
  router,
};
