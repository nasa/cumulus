'use strict';

const router = require('express-promise-router')();

const { inTestMode } = require('@cumulus/common/test-utils');
const {
  RecordDoesNotExist,
  InvalidRegexError,
  UnmatchedRegexError,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { Search } = require('../es/search');
const { addToLocalES, indexCollection } = require('../es/indexer');
const models = require('../models');
const Collection = require('../es/collections');
const { AssociatedRulesError, isBadRequestError } = require('../lib/errors');

const log = new Logger({ sender: '@cumulus/api/collections' });

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
  try {
    const data = req.body;
    const name = data.name;
    const version = data.version;

    // make sure primary key is included
    if (!name || !version) {
      return res.boom.badRequest('Field name and/or version is missing');
    }
    const c = new models.Collection();

    try {
      await c.get({ name, version });
      return res.boom.conflict(`A record already exists for ${name} version: ${version}`);
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        await c.create(data);

        if (inTestMode()) {
          await addToLocalES(data, indexCollection);
        }

        return res.send({ message: 'Record saved', record: data });
      }
      throw error;
    }
  } catch (error) {
    if (
      isBadRequestError(error)
      || error instanceof InvalidRegexError
      || error instanceof UnmatchedRegexError
    ) {
      return res.boom.badRequest(error.message);
    }
    log.error('Error occurred while trying to create collection:', error);
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
async function put({ params: { name, version }, body }, res) {
  if (name !== body.name || version !== body.version) {
    return res.boom.badRequest('Expected collection name and version to be'
      + ` '${name}' and '${version}', respectively, but found '${body.name}'`
      + ` and '${body.version}' in payload`);
  }

  const collectionModel = new models.Collection();

  if (!(await collectionModel.exists(name, version))) {
    return res.boom.notFound(
      `Collection '${name}' version '${version}' not found`
    );
  }

  const record = await collectionModel.create(body);

  if (inTestMode()) {
    await addToLocalES(record, indexCollection);
  }

  return res.send(record);
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

  const collectionModel = new models.Collection();

  try {
    await collectionModel.delete({ name, version });

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

module.exports = router;
