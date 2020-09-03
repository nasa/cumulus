'use strict';

const omit = require('lodash/omit');
const router = require('express-promise-router')();
const { inTestMode } = require('@cumulus/common/test-utils');
const {
  InvalidRegexError,
  UnmatchedRegexError,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { getKnexClient } = require('@cumulus/db');
const { Search } = require('../es/search');
const { addToLocalES, indexCollection } = require('../es/indexer');
const models = require('../models');
const Collection = require('../es/collections');
const { AssociatedRulesError, isBadRequestError } = require('../lib/errors');

const log = new Logger({ sender: '@cumulus/api/collections' });

const dynamoRecordToDbRecord = (dynamoRecord) => {
  const dbRecord = {
    ...dynamoRecord,
    granuleIdExtractionRegex: dynamoRecord.granuleIdExtraction,
    granuleIdValidationRegex: dynamoRecord.granuleId,
    files: JSON.stringify(dynamoRecord.files),
  };

  delete dbRecord.createdAt;
  delete dbRecord.granuleId;
  delete dbRecord.granuleIdExtraction;
  delete dbRecord.updatedAt;

  // eslint-disable-next-line lodash/prefer-lodash-typecheck
  if (typeof dynamoRecord.createdAt === 'number') {
    dbRecord.created_at = new Date(dynamoRecord.createdAt);
  }

  // eslint-disable-next-line lodash/prefer-lodash-typecheck
  if (typeof dynamoRecord.updatedAt === 'number') {
    dbRecord.updated_at = new Date(dynamoRecord.updatedAt);
  }

  if (dynamoRecord.tags) {
    dbRecord.tags = JSON.stringify(dynamoRecord.tags);
  }

  return dbRecord;
};

/**
 * List all collections.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const collection = new Collection(
    { queryStringParameters: req.query },
    undefined,
    process.env.ES_INDEX
  );
  const result = await collection.query();
  return res.send(result);
}

/**
 * List all collections with active granules
 * If time params are specified the query will return collections
 * that have granules that have been updated in that time frame.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function activeList(req, res) {
  const collection = new Collection(
    { queryStringParameters: req.query },
    undefined,
    process.env.ES_INDEX
  );
  const result = await collection.queryCollectionsWithActiveGranules();
  return res.send(result);
}

/**
 * Query a single collection.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const name = req.params.name;
  const version = req.params.version;

  try {
    const c = new models.Collection();
    const result = await c.get({ name, version });
    // const stats = await collection.getStats([res], [res.name]);
    return res.send(result);
  } catch (error) {
    return res.boom.notFound(error.message);
  }
}

/**
 * Creates a new collection
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const {
    collectionsModel = new models.Collection(),
    dbClient = await getKnexClient(),
    logger = log,
  } = req.testContext || {};

  const collection = req.body || {};
  const { name, version } = collection;

  if (!name || !version) {
    return res.boom.badRequest('Field name and/or version is missing');
  }

  if (await collectionsModel.exists(name, version)) {
    return res.boom.conflict(`A record already exists for ${name} version: ${version}`);
  }

  try {
    const dynamoRecord = await collectionsModel.create(
      omit(collection, 'dataType')
    );

    const dbRecord = dynamoRecordToDbRecord(dynamoRecord);

    try {
      await dbClient('collections').insert(dbRecord, 'cumulusId');
    } catch (error) {
      await collectionsModel.delete({ name, version });

      throw error;
    }

    if (inTestMode()) {
      await addToLocalES(collection, indexCollection);
    }

    return res.send({
      message: 'Record saved',
      record: collection,
    });
  } catch (error) {
    if (
      isBadRequestError(error)
      || error instanceof InvalidRegexError
      || error instanceof UnmatchedRegexError
    ) {
      return res.boom.badRequest(error.message);
    }
    logger.error('Error occurred while trying to create collection:', error);
    return res.boom.badImplementation(error.message);
  }
}

/**
 * Updates an existing collection
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res) {
  const { name, version } = req.params;
  const collection = req.body;

  if (name !== collection.name || version !== collection.version) {
    return res.boom.badRequest('Expected collection name and version to be'
      + ` '${name}' and '${version}', respectively, but found '${collection.name}'`
      + ` and '${collection.version}' in payload`);
  }

  const collectionsModel = new models.Collection();

  if (!(await collectionsModel.exists(name, version))) {
    return res.boom.notFound(
      `Collection '${name}' version '${version}' not found`
    );
  }

  const dynamoRecord = await collectionsModel.create(collection);

  const dbRecord = dynamoRecordToDbRecord(dynamoRecord);

  const dbClient = await getKnexClient();
  await dbClient.transaction(async (trx) => {
    await trx('collections').where({ name, version }).del();
    await trx('collections').insert(dbRecord);
  });

  if (inTestMode()) {
    await addToLocalES(dynamoRecord, indexCollection);
  }

  return res.send(dynamoRecord);
}

/**
 * Delete a collection record
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const { name, version } = req.params;

  const collectionsModel = new models.Collection();
  const dbClient = await getKnexClient();

  try {
    await collectionsModel.delete({ name, version });

    await dbClient('collections').where({ name, version }).del();

    if (inTestMode()) {
      const collectionId = constructCollectionId(name, version);
      const esClient = await Search.es(process.env.ES_HOST);
      await esClient.delete({
        id: collectionId,
        index: process.env.ES_INDEX,
        type: 'collection',
      }, { ignore: [404] });
    }

    return res.send({ message: 'Record deleted' });
  } catch (error) {
    if (error instanceof AssociatedRulesError) {
      const message = `Cannot delete collection with associated rules: ${error.rules.join(', ')}`;
      return res.boom.conflict(message);
    }
    throw error;
  }
}

// express routes
router.get('/:name/:version', get);
router.put('/:name/:version', put);
router.delete('/:name/:version', del);
router.post('/', post);
router.get('/', list);
router.get('/active', activeList);

module.exports = {
  del,
  dynamoRecordToDbRecord,
  post,
  put,
  router,
};
