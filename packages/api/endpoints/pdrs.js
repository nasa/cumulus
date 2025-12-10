//@ts-check

'use strict';

const router = require('express-promise-router')();
const S3UtilsLib = require('@cumulus/aws-client/S3');
const {
  getKnexClient,
  PdrPgModel,
  translatePostgresPdrToApiPdr,
  createRejectableTransaction,
} = require('@cumulus/db');
const { errorify, RecordDoesNotExist } = require('@cumulus/errors');
const { PdrSearch } = require('@cumulus/db');
const Logger = require('@cumulus/logger');

// Import OpenTelemetry
const { trace } = require('@opentelemetry/api');

const log = new Logger({ sender: '@cumulus/api/pdrs' });

// Get the tracer
const tracer = trace.getTracer('cumulus-api-pdrs');

/**
 * List and search pdrs
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  return tracer.startActiveSpan('pdrs.list', async (span) => {
    try {
      span.setAttribute('pdrs.has_query_params', Object.keys(req.query).length > 0);

      const dbSearch = new PdrSearch({ queryStringParameters: req.query });
      const result = await dbSearch.query();

      span.setAttribute('pdrs.result_count', result?.meta?.count || 0);
      span.setAttribute('pdrs.results_returned', result?.results?.length || 0);

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
 * get a single PDR
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  return tracer.startActiveSpan('pdrs.get', async (span) => {
    try {
      const pdrName = req.params.pdrName;

      span.setAttribute('pdr.name', pdrName);

      const knex = await getKnexClient();
      const pdrPgModel = new PdrPgModel();

      try {
        const pgPdr = await tracer.startActiveSpan('pdrPgModel.get', async (dbSpan) => {
          try {
            return await pdrPgModel.get(knex, { name: pdrName });
          } finally {
            dbSpan.end();
          }
        });

        const result = await tracer.startActiveSpan('translatePostgresPdrToApiPdr', async (translateSpan) => {
          try {
            return await translatePostgresPdrToApiPdr(pgPdr, knex);
          } finally {
            translateSpan.end();
          }
        });

        span.setAttribute('pdr.status', result.status);
        span.setAttribute('pdr.progress', result.progress);
        span.setAttribute('pdr.collection_id', result.collectionId);
        span.setAttribute('pdr.provider', result.provider);

        return res.send(result);
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('pdr.not_found', true);
          return res.boom.notFound(`No record found for ${pdrName}`);
        }
        throw error;
      }
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
 * delete a given PDR
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  return tracer.startActiveSpan('pdrs.del', async (span) => {
    try {
      const {
        pdrPgModel = new PdrPgModel(),
        knex = await getKnexClient(),
        s3Utils = S3UtilsLib,
      } = req.testContext || {};

      const pdrName = req.params.pdrName;
      const pdrS3Key = `${process.env.stackName}/pdrs/${pdrName}`;

      span.setAttribute('pdr.name', pdrName);
      span.setAttribute('pdr.s3_key', pdrS3Key);
      span.setAttribute('pdr.s3_bucket', process.env.system_bucket);

      try {
        await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
          try {
            await createRejectableTransaction(knex, async (trx) => {
              const deleteResultsCount = await tracer.startActiveSpan('pdrPgModel.delete', async (deleteSpan) => {
                try {
                  deleteSpan.setAttribute('pdr.name', pdrName);
                  return await pdrPgModel.delete(trx, { name: pdrName });
                } finally {
                  deleteSpan.end();
                }
              });

              if (deleteResultsCount === 0) {
                span.setAttribute('pdr.not_found', true);
                return res.boom.notFound('No record found');
              }

              span.setAttribute('pdr.db_deleted', true);

              await tracer.startActiveSpan('s3Utils.deleteS3Object', async (s3Span) => {
                try {
                  s3Span.setAttribute('s3.bucket', process.env.system_bucket);
                  s3Span.setAttribute('s3.key', pdrS3Key);
                  return await s3Utils.deleteS3Object(process.env.system_bucket, pdrS3Key);
                } finally {
                  s3Span.end();
                }
              });

              span.setAttribute('pdr.s3_deleted', true);
            });
          } finally {
            txSpan.end();
          }
        });
      } catch (error) {
        log.debug(`Failed to delete PDR with name ${pdrName}. Error ${errorify(error)}.`);
        span.recordException(error);
        span.setAttribute('error', true);
        throw error;
      }

      return res.send({ detail: 'Record deleted' });
    } finally {
      span.end();
    }
  });
}

router.get('/:pdrName', get);
router.get('/', list);
router.delete('/:pdrName', del);

module.exports = {
  del,
  router,
};
