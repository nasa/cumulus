'use strict';

const router = require('express-promise-router')();
const S3UtilsLib = require('@cumulus/aws-client/S3');
const {
  getKnexClient,
  PdrPgModel,
  translatePostgresPdrToApiPdr,
  createRejectableTransaction,
} = require('@cumulus/db');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { indexPdr, deletePdr } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const Logger = require('@cumulus/logger');
const models = require('../models');

const log = new Logger({ sender: '@cumulus/api/pdrs' });

/**
 * List and search pdrs
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const table = 'pdrs';
  const queryParameters = req.query;
  const perPage = Number.parseInt((queryParameters.limit) ? queryParameters.limit : 10, 10)
  const currentPage = Number.parseInt((queryParameters.page) ? queryParameters.page : 1, 10);
  const knex = await getKnexClient();
  const response = await knex('pdrs').paginate({
    perPage,
    currentPage,
  });
  const results = response.data;

  const queryResults = {
    results,
    meta: {
      ...response.pagination,
       stack: process.env.stackName,
       count: response.pagination.total,
       page: response.pagination.currentPage,
       table,
    }
  };

  return res.send(queryResults);
}

/**
 * get a single PDR
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const pdrName = req.params.pdrName;

  const knex = await getKnexClient();
  const pdrPgModel = new PdrPgModel();

  try {
    const pgPdr = await pdrPgModel.get(knex, { name: pdrName });
    const result = await translatePostgresPdrToApiPdr(pgPdr, knex);
    return res.send(result);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${pdrName}`);
    }
    throw error;
  }
}

const isRecordDoesNotExistError = (e) => e.message.includes('RecordDoesNotExist');

/**
 * delete a given PDR
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    pdrModel = new models.Pdr(),
    pdrPgModel = new PdrPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
    s3Utils = S3UtilsLib,
  } = req.testContext || {};

  const pdrName = req.params.pdrName;
  const pdrS3Key = `${process.env.stackName}/pdrs/${pdrName}`;
  const esPdrsClient = new Search(
    {},
    'pdr',
    process.env.ES_INDEX
  );

  let existingPdr;
  try {
    await pdrPgModel.get(knex, { name: pdrName });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (!(await esPdrsClient.exists(pdrName))) {
        log.info('PDR does not exist in Elasticsearch');
        return res.boom.notFound('No record found');
      }
      log.info('PDR does not exist in PostgreSQL, it only exists in Elasticsearch');
    } else {
      throw error;
    }
  }

  try {
    // Save DynamoDb PDR in case delete fails and we need to recreate
    existingPdr = await pdrModel.get({ pdrName });
  } catch (error) {
    // Ignore error if record does not exist in DynamoDb
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  const esPdrClient = new Search(
    {},
    'pdr',
    process.env.ES_INDEX
  );
  const esPdrRecord = await esPdrClient.get(pdrName).catch(log.info);

  try {
    let dynamoPdrDeleted = false;
    let esPdrDeleted = false;
    try {
      await createRejectableTransaction(knex, async (trx) => {
        await pdrPgModel.delete(trx, { name: pdrName });
        await pdrModel.delete({ pdrName });
        dynamoPdrDeleted = true;
        await deletePdr({
          esClient,
          name: pdrName,
          index: process.env.ES_INDEX,
          ignore: [404],
        });
        esPdrDeleted = true;
        await s3Utils.deleteS3Object(process.env.system_bucket, pdrS3Key);
      });
    } catch (innerError) {
      // Delete is idempotent, so there may not be a DynamoDB
      // record to recreate
      if (dynamoPdrDeleted && existingPdr) {
        await pdrModel.create(existingPdr);
      }
      if (esPdrDeleted && esPdrRecord) {
        delete esPdrRecord._id;
        await indexPdr(esClient, esPdrRecord, process.env.ES_INDEX);
      }
      throw innerError;
    }
  } catch (error) {
    log.debug(`Failed to delete PDR with name ${pdrName}. Error ${JSON.stringify(error)}.`);
    if (!isRecordDoesNotExistError(error)) throw error;
  }
  return res.send({ detail: 'Record deleted' });
}

router.get('/:pdrName', get);
router.get('/', list);
router.delete('/:pdrName', del);

module.exports = {
  del,
  router,
};
