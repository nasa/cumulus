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

const log = new Logger({ sender: '@cumulus/api/pdrs' });

/**
 * List and search pdrs
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const dbSearch = new PdrSearch({ queryStringParameters: req.query });
  const result = await dbSearch.query();
  return res.send(result);
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

/**
 * delete a given PDR
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    pdrPgModel = new PdrPgModel(),
    knex = await getKnexClient(),
    s3Utils = S3UtilsLib,
  } = req.testContext || {};

  const pdrName = req.params.pdrName;
  const pdrS3Key = `${process.env.stackName}/pdrs/${pdrName}`;

  try {
    await createRejectableTransaction(knex, async (trx) => {
      const deleteResultsCount = await pdrPgModel.delete(trx, { name: pdrName });
      if (deleteResultsCount === 0) {
        return res.boom.notFound('No record found');
      }
      return await s3Utils.deleteS3Object(process.env.system_bucket, pdrS3Key);
    });
  } catch (error) {
    log.debug(`Failed to delete PDR with name ${pdrName}. Error ${errorify(error)}.`);
    throw error;
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
