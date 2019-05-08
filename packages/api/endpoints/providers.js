'use strict';

const router = require('express-promise-router')();
const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/common/errors');
const models = require('../models');
const { AssociatedRulesError } = require('../lib/errors');
const { Search } = require('../es/search');
const indexer = require('../es/indexer');

/**
 * List all providers
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search({
    queryStringParameters: req.query
  }, 'provider');
  const response = await search.query();
  return res.send(response);
}

/**
 * Query a single provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const id = req.params.id;

  const providerModel = new models.Provider();
  let result;
  try {
    result = await providerModel.get({ id });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) return res.boom.notFound('Provider not found.');
  }
  delete result.password;
  return res.send(result);
}

/**
 * Creates a new provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {function} next - Calls the next middleware function
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res, next) {
  const data = req.body;
  const id = data.id;

  const providerModel = new models.Provider();

  try {
    // make sure the record doesn't exist
    await providerModel.get({ id });
    return res.boom.badReqest(`A record already exists for ${id}`);
  } catch (e) {
    if (e instanceof RecordDoesNotExist) {
      const record = await providerModel.create(data);
      req.providerRecord = record;
      req.returnMessage = { record, message: 'Record saved' };
      if (inTestMode()) return next();
      return res.send({ record, message: 'Record saved' });
    }
    return res.boom.badImplementation(e.message);
  }
}

/**
 * Updates an existing provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {function} next - Calls the next middleware function
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res, next) {
  const id = req.params.id;

  const data = req.body;
  const providerModel = new models.Provider();

  // get the record first
  try {
    await providerModel.get({ id });
    const record = await providerModel.update({ id }, data);
    req.providerRecord = record;
    if (inTestMode()) return next();
    return res.send(record);
  } catch (err) {
    if (err instanceof RecordDoesNotExist) return res.boom.notFound('Record does not exist');
    throw err;
  }
}

/**
 * Delete a provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @param {function} next - Calls the next middleware function
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res, next) {
  const providerModel = new models.Provider();

  try {
    await providerModel.delete({ id: req.params.id });
    if (inTestMode()) return next();
    return res.send({ message: 'Record deleted' });
  } catch (err) {
    if (err instanceof AssociatedRulesError) {
      const message = `Cannot delete provider with associated rules: ${err.rules.join(', ')}`;
      return res.boom.conflict(message);
    }
    throw err;
  }
}

async function addToES(req, res) {
  const provider = req.providerRecord;

  if (inTestMode()) {
    const esClient = await Search.es(process.env.ES_HOST);
    const esIndex = process.env.esIndex;
    indexer.indexProvider(esClient, provider, esIndex);
  }
  if (req.returnMessage) return res.send(req.returnMessage);
  return res.send(provider);
}

async function removeFromES(req, res) {
  const id = req.params.id;
  if (inTestMode()) {
    const esClient = await Search.es(process.env.ES_HOST);
    const esIndex = process.env.esIndex;
    esClient.delete({ id, index: esIndex, type: 'provider' });
  }
  return res.send({ message: 'Record deleted' });
}

// express routes
router.get('/:id', get);
router.put('/:id', put, addToES);
router.delete('/:id', del, removeFromES);
router.post('/', post, addToES);
router.get('/', list);

module.exports = router;
