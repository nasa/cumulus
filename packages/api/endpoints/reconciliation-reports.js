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

// Import OpenTelemetry
const { trace } = require('@opentelemetry/api');

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

// Get the tracer
const tracer = trace.getTracer('cumulus-api-reconciliation-reports');

const maxResponsePayloadSizeBytes = 6 * 1000 * 1000;

/**
 * @typedef {import('../lib/types').NormalizedRecReportParams} NormalizedRecReportParams
 * @typedef {import('../lib/types').RecReportParams} RecReportParams
 */

/**
 * List all reconciliation reports
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function listReports(req, res) {
  return await tracer.startActiveSpan('reconciliation-reports.list', async (span) => {
    try {
      span.setAttribute('reconciliation_reports.has_query_params', Object.keys(req.query).length > 0);

      const dbSearch = new ReconciliationReportSearch(
        { queryStringParameters: req.query }
      );
      const result = await dbSearch.query();

      span.setAttribute('reconciliation_reports.result_count', result?.meta?.count || 0);
      span.setAttribute('reconciliation_reports.results_returned', result?.results?.length || 0);

      return res.send(result);
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * get a reconciliation report
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function getReport(req, res) {
  return await tracer.startActiveSpan('reconciliation-reports.get', async (span) => {
    try {
      const name = req.params.name;

      span.setAttribute('reconciliation_report.name', name);

      try {
        const reconciliationReportPgModel = new ReconciliationReportPgModel();
        const knex = await getKnexClient();

        const result = await tracer.startActiveSpan('reconciliationReportPgModel.get', async (dbSpan) => {
          try {
            return await reconciliationReportPgModel.get(knex, { name });
          } finally {
            dbSpan.end();
          }
        });

        if (!result.location) {
          span.setAttribute('reconciliation_report.missing_location', true);
          return res.boom.badRequest('The reconciliation report record does not contain a location.');
        }

        const { Bucket, Key } = parseS3Uri(result.location);

        span.setAttribute('reconciliation_report.s3_bucket', Bucket);
        span.setAttribute('reconciliation_report.s3_key', Key);
        span.setAttribute('reconciliation_report.file_type', Key.split('.').pop());

        const reportExists = await tracer.startActiveSpan('fileExists', async (existsSpan) => {
          try {
            existsSpan.setAttribute('s3.bucket', Bucket);
            existsSpan.setAttribute('s3.key', Key);
            return await fileExists(Bucket, Key);
          } finally {
            existsSpan.end();
          }
        });

        if (!reportExists) {
          span.setAttribute('reconciliation_report.file_not_found', true);
          return res.boom.notFound('The report does not exist!');
        }

        const downloadFile = Key.split('/').pop();
        const s3ObjectStoreClient = new S3ObjectStore();
        const s3ObjectUrl = buildS3Uri(Bucket, Key);

        const presignedS3Url = await tracer.startActiveSpan('s3ObjectStoreClient.signGetObject', async (signSpan) => {
          try {
            return await s3ObjectStoreClient.signGetObject(
              s3ObjectUrl,
              {
                ResponseContentDisposition: `attachment; filename="${downloadFile}"`,
              }
            );
          } finally {
            signSpan.end();
          }
        });

        if (Key.endsWith('.json') || Key.endsWith('.csv')) {
          const reportSize = await tracer.startActiveSpan('getObjectSize', async (sizeSpan) => {
            try {
              sizeSpan.setAttribute('s3.bucket', Bucket);
              sizeSpan.setAttribute('s3.key', Key);
              const size = await getObjectSize({ s3: s3(), bucket: Bucket, key: Key }) ?? 0;
              sizeSpan.setAttribute('s3.object_size', size);
              return size;
            } finally {
              sizeSpan.end();
            }
          });

          const estimatedPayloadSize = presignedS3Url.length + reportSize + 50;
          const maxSize = Number(
            process.env.maxResponsePayloadSizeBytes || maxResponsePayloadSizeBytes
          );

          span.setAttribute('reconciliation_report.estimated_payload_size', estimatedPayloadSize);
          span.setAttribute('reconciliation_report.max_payload_size', maxSize);
          span.setAttribute('reconciliation_report.exceeds_max_size', estimatedPayloadSize > maxSize);

          if (estimatedPayloadSize > maxSize) {
            return res.json({
              presignedS3Url,
              data: `Error: Report ${name} exceeded maximum allowed payload size`,
            });
          }
          const file = await tracer.startActiveSpan('getObject', async (getSpan) => {
            try {
              getSpan.setAttribute('s3.bucket', Bucket);
              getSpan.setAttribute('s3.key', Key);
              return await getObject(s3(), { Bucket, Key });
            } finally {
              getSpan.end();
            }
          });

          logger.debug(`Sending json file with contentLength ${file.ContentLength}`);
          span.setAttribute('reconciliation_report.content_length', file.ContentLength);

          if (!file.Body) {
            span.setAttribute('reconciliation_report.missing_body', true);
            return res.boom.badRequest('Report file does not have a body.');
          }

          const fileBody = await tracer.startActiveSpan('getObjectStreamContents', async (streamSpan) => {
            try {
              return await getObjectStreamContents(file.Body);
            } finally {
              streamSpan.end();
            }
          });

          span.setAttribute('reconciliation_report.body_length', fileBody.length);

          return res.json({
            presignedS3Url,
            data: Key.endsWith('.json') ? JSON.parse(fileBody) : fileBody,
          });
        }

        span.setAttribute('reconciliation_report.unhandled_type', true);
        logger.debug('Reconciliation report getReport received an unhandled report type.');
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('reconciliation_report.not_found', true);
          return res.boom.notFound(`No record found for ${name}`);
        }
        throw error;
      }

      return res.boom.badImplementation('Reconciliation report getReport failed in an indeterminate manner.');
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * delete a reconciliation report
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function deleteReport(req, res) {
  return await tracer.startActiveSpan('reconciliation-reports.delete', async (span) => {
    try {
      const name = req.params.name;
      let record;

      span.setAttribute('reconciliation_report.name', name);

      const reconciliationReportPgModel = new ReconciliationReportPgModel();
      const knex = await getKnexClient();

      try {
        record = await tracer.startActiveSpan('reconciliationReportPgModel.get', async (dbSpan) => {
          try {
            return await reconciliationReportPgModel.get(knex, { name });
          } finally {
            dbSpan.end();
          }
        });
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('reconciliation_report.not_found', true);
          return res.boom.notFound(`No record found for ${name}`);
        }
        throw error;
      }

      if (!record.location) {
        span.setAttribute('reconciliation_report.missing_location', true);
        return res.boom.badRequest('The reconciliation report record does not contain a location!');
      }

      const { Bucket, Key } = parseS3Uri(record.location);

      span.setAttribute('reconciliation_report.s3_bucket', Bucket);
      span.setAttribute('reconciliation_report.s3_key', Key);

      await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
        try {
          await createRejectableTransaction(knex, async () => {
            const exists = await tracer.startActiveSpan('fileExists', async (existsSpan) => {
              try {
                existsSpan.setAttribute('s3.bucket', Bucket);
                existsSpan.setAttribute('s3.key', Key);
                return await fileExists(Bucket, Key);
              } finally {
                existsSpan.end();
              }
            });

            span.setAttribute('reconciliation_report.s3_file_exists', exists);

            if (exists) {
              await tracer.startActiveSpan('deleteS3Object', async (s3DeleteSpan) => {
                try {
                  s3DeleteSpan.setAttribute('s3.bucket', Bucket);
                  s3DeleteSpan.setAttribute('s3.key', Key);
                  await deleteS3Object(Bucket, Key);
                } finally {
                  s3DeleteSpan.end();
                }
              });
              span.setAttribute('reconciliation_report.s3_deleted', true);
            }

            await tracer.startActiveSpan('reconciliationReportPgModel.delete', async (dbDeleteSpan) => {
              try {
                await reconciliationReportPgModel.delete(knex, { name });
              } finally {
                dbDeleteSpan.end();
              }
            });
            span.setAttribute('reconciliation_report.db_deleted', true);
          });
        } finally {
          txSpan.end();
        }
      });

      return res.send({ message: 'Report deleted' });
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Creates a new report
 *
 * @param {object} req - express request object
 * @param {RecReportParams} req.body
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function createReport(req, res) {
  return await tracer.startActiveSpan('reconciliation-reports.create', async (span) => {
    try {
      /** @type NormalizedRecReportParams */
      let validatedInput;
      try {
        validatedInput = await tracer.startActiveSpan('normalizeEvent', async (normalizeSpan) => {
          try {
            normalizeSpan.setAttribute('reconciliation_report.has_report_name', !!req.body.reportName);
            normalizeSpan.setAttribute('reconciliation_report.has_report_type', !!req.body.reportType);
            return await normalizeEvent(req.body);
          } finally {
            normalizeSpan.end();
          }
        });
      } catch (error) {
        logger.error(error);
        span.setAttribute('reconciliation_report.validation_error', true);
        span.recordException(error);
        span.setAttribute('error', true);
        return res.boom.badRequest(error.message, error);
      }
      span.setAttribute('reconciliation_report.report_name', validatedInput.reportName);
      span.setAttribute('reconciliation_report.report_type', validatedInput.reportType);
      const asyncOperationId = uuidv4();
      span.setAttribute('reconciliation_report.async_operation_id', asyncOperationId);
      const asyncOperationEvent = {
        asyncOperationId,
        callerLambdaName: getFunctionNameFromRequestContext(req),
        lambdaName: process.env.invokeReconcileLambda,
        description: 'Create Reconciliation Report',
        operationType: 'Reconciliation Report',
        payload: validatedInput,
      };
      logger.debug(`About to invoke lambda to start async operation ${asyncOperationId}`);
      await tracer.startActiveSpan('invokeStartAsyncOperationLambda', async (lambdaSpan) => {
        try {
          await startAsyncOperation.invokeStartAsyncOperationLambda(asyncOperationEvent);
        } finally {
          lambdaSpan.end();
        }
      });
      return res.status(202).send({ id: asyncOperationId });
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

router.get('/:name', getReport);
router.delete('/:name', deleteReport);
router.get('/', listReports);
router.post('/', createReport, asyncOperationEndpointErrorHandler);

module.exports = {
  createReport,
  router,
};
