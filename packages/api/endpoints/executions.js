'use strict';

const router = require('express-promise-router')();

const { RecordDoesNotExist } = require('@cumulus/errors');
const {
  getKnexClient,
  ExecutionPgModel,
  AsyncOperationPgModel,
  CollectionPgModel,
} = require('@cumulus/db');

const Search = require('../es/search').Search;

/**
 * List and search executions
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'execution',
    process.env.ES_INDEX
  );
  const response = await search.query();
  return res.send(response);
}

/**
 * get a single execution
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const arn = req.params.arn;
  const knex = await getKnexClient({ env: process.env });
  const executionPgModel = new ExecutionPgModel();
  const asyncOperationPgModel = new AsyncOperationPgModel();
  const collectionPgModel = new CollectionPgModel();

  let asyncOperationId;
  let parentArn;
  let collectionId;
  let executionRecord;
  try {
    executionRecord = await executionPgModel.get(knex, { arn });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${arn}`);
    }
    throw error;
  }

  if (executionRecord.collection_cumulus_id) {
    const collection = await collectionPgModel.get(knex, {
      cumulus_id: executionRecord.collection_cumulus_id,
    });
    collectionId = `${collection.name}___${collection.version}`;
  }
  if (executionRecord.async_operation_cumulus_id) {
    const asyncOperation = await asyncOperationPgModel.get(knex, {
      cumulus_id: executionRecord.async_operation_cumulus_id,
    });
    asyncOperationId = asyncOperation.id;
  }
  if (executionRecord.parent_cumulus_id) {
    const parentExecution = await executionPgModel.get(knex, {
      cumulus_id: executionRecord.parent_cumulus_id,
    });
    parentArn = parentExecution.arn;
  }
  return res.send({
    ...executionRecord,
    asyncOperationId,
    collectionId,
    parentArn: parentArn,
  });
}

router.get('/:arn', get);
router.get('/', list);

module.exports = router;
