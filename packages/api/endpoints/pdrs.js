'use strict';

const router = require('express-promise-router')();
const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');
const {
  getKnexClient,
  PdrPgModel,
} = require('@cumulus/db');
const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const Search = require('../es/search').Search;
const models = require('../models');

/**
 * List and search pdrs
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'pdr',
    process.env.ES_INDEX
  );
  const result = await search.query();
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

  const pdrModel = new models.Pdr();

  try {
    const result = await pdrModel.get({ pdrName });
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
  const pdrName = req.params.pdrName;

  const pdrS3Key = `${process.env.stackName}/pdrs/${pdrName}`;

  const pdrModel = new models.Pdr();
  const pdrPgModel = new PdrPgModel();
  const knex = await getKnexClient();

  try {
    await knex.transaction(async (trx) => {
      await pdrPgModel.delete(trx, { name: pdrName });
      await deleteS3Object(process.env.system_bucket, pdrS3Key);
      await pdrModel.delete({ pdrName });
    });

    if (inTestMode()) {
      const esClient = await Search.es(process.env.ES_HOST);
      await esClient.delete({
        id: pdrName,
        index: process.env.ES_INDEX,
        type: 'pdr',
      }, { ignore: [404] });
    }
  } catch (error) {
    if (!isRecordDoesNotExistError(error)) throw error;
  }
  return res.send({ detail: 'Record deleted' });
}

router.get('/:pdrName', get);
router.get('/', list);
router.delete('/:pdrName', del);

module.exports = router;
