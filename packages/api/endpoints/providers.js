'use strict';

const router = require('express-promise-router')();
const models = require('../models');
const {
  AssociatedRulesError,
  RecordDoesNotExist
} = require('../lib/errors');

/**
 * List all providers
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const instance = new models.Provider();
  const result = await instance.search(req.query);
  return res.send(result);
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
  }
  catch (error) {
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
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const data = req.body;
  const id = data.id;

  const providerModel = new models.Provider();

  try {
    // make sure the record doesn't exist
    await providerModel.get({ id });
    return res.boom.badReqest(`A record already exists for ${id}`);
  }
  catch (e) {
    if (e instanceof RecordDoesNotExist) {
      const record = await providerModel.create(data);
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
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res) {
  const id = req.params.id;

  const data = req.body;
  const providerModel = new models.Provider();

  // get the record first
  try {
    await providerModel.get({ id });
    const record = await providerModel.update({ id }, data);
    return res.send(record);
  }
  catch (err) {
    if (err instanceof RecordDoesNotExist) return res.boom.notFound('Record does not exist');
    throw err;
  }
}

/**
 * Delete a provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const providerModel = new models.Provider();

  try {
    await providerModel.delete({ id: req.params.id });
    return res.send({ message: 'Record deleted' });
  }
  catch (err) {
    if (err instanceof AssociatedRulesError) {
      const message = `Cannot delete provider with associated rules: ${err.rules.join(', ')}`;
      return res.boom.conflict(message);
    }
    throw err;
  }
}

// express routes
router.get('/:id', get);
router.put('/:id', put);
router.delete('/:id', del);
router.post('/', post);
router.get('/', list);

module.exports = router;
