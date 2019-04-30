'use strict';

const router = require('express-promise-router')();
const { inTestMode } = require('@cumulus/common/test-utils');
const models = require('../models');
const Collection = require('../es/collections');
const {
  AssociatedRulesError,
  RecordDoesNotExist
} = require('../lib/errors');

/**
 * List all collections.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {*} next - Calls the next middleware function
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res, next) {
  if (inTestMode()) {
    return next();
  }
  const collection = new Collection({
    queryStringParameters: req.query
  });
  const result = await collection.query();
  return res.send(result);
}

async function dynamoList(req, res, next) {
  if (!inTestMode()) {
    return next();
  }
  const collectionModel = new models.Collection();
  let results;
  try {
    results = await collectionModel.getAllCollections();
  } catch (error) {
    return res.boom.notFound(error.message);
  }
  return res.send({ results });
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
  } catch (e) {
    return res.boom.notFound(e.message);
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
      return res.boom.notFound('Field name and/or version is missing');
    }
    const c = new models.Collection();

    try {
      await c.get({ name, version });
      return res.boom.badRequest(`A record already exists for ${name} version: ${version}`);
    } catch (e) {
      if (e instanceof RecordDoesNotExist) {
        await c.create(data);
        return res.send({ message: 'Record saved', record: data });
      }
      throw e;
    }
  } catch (e) {
    return res.boom.badImplementation(e.message);
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
  const pname = req.params.name;
  const pversion = req.params.version;

  let data = req.body;

  const name = data.name;
  const version = data.version;

  if (pname !== name || pversion !== version) {
    return res.boom.notFound('name and version in path doesn\'t match the payload');
  }

  const c = new models.Collection();

  // get the record first
  try {
    const originalData = await c.get({ name, version });
    data = Object.assign({}, originalData, data);
    const result = await c.create(data);
    return res.send(result);
  } catch (err) {
    if (err instanceof RecordDoesNotExist) {
      return res.boom.notFound('Record does not exist');
    }
    throw err;
  }
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
    return res.send({ message: 'Record deleted' });
  } catch (err) {
    if (err instanceof AssociatedRulesError) {
      const message = `Cannot delete collection with associated rules: ${err.rules.join(', ')}`;
      return res.boom.conflict(message);
    }
    throw err;
  }
}

// express routes
router.get('/:name/:version', get);
router.put('/:name/:version', put);
router.delete('/:name/:version', del);
router.post('/', post);
router.get('/', dynamoList, list);

module.exports = router;
