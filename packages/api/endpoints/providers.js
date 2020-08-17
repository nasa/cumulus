'use strict';

const router = require('express-promise-router')();
const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const Provider = require('../models/providers');
const { AssociatedRulesError, isBadRequestError } = require('../lib/errors');
const { Search } = require('../es/search');
const { addToLocalES, indexProvider } = require('../es/indexer');

const log = new Logger({ sender: '@cumulus/api/providers' });

/**
 * List all providers
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'provider',
    process.env.ES_INDEX
  );

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

  const providerModel = new Provider();
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
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  try {
    const data = req.body;
    const id = data.id;

    const providerModel = new Provider();

    try {
      // make sure the record doesn't exist
      await providerModel.get({ id });
      return res.boom.conflict(`A record already exists for ${id}`);
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        const record = await providerModel.create(data);

        if (inTestMode()) {
          await addToLocalES(record, indexProvider);
        }
        return res.send({ record, message: 'Record saved' });
      }
      throw error;
    }
  } catch (error) {
    if (isBadRequestError(error)) {
      return res.boom.badRequest(error.message);
    }
    log.error('Error occurred while trying to create provider:', error);
    return res.boom.badImplementation(error.message);
  }
}

/**
 * Updates an existing provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function put({ params: { id }, body }, res) {
  if (id !== body.id) {
    return res.boom.badRequest(
      `Expected provider ID to be '${id}', but found '${body.id}' in payload`
    );
  }

  const providerModel = new Provider();

  if (!(await providerModel.exists(id))) {
    return res.boom.notFound(
      `Provider with ID '${id}' not found`
    );
  }

  const record = await providerModel.create(body);

  if (inTestMode()) {
    await addToLocalES(record, indexProvider);
  }

  return res.send(record);
}

/**
 * Delete a provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const providerModel = new Provider();

  try {
    await providerModel.delete({ id: req.params.id });

    if (inTestMode()) {
      const esClient = await Search.es(process.env.ES_HOST);
      await esClient.delete({
        id: req.params.id,
        type: 'provider',
        index: process.env.ES_INDEX,
      }, { ignore: [404] });
    }
    return res.send({ message: 'Record deleted' });
  } catch (error) {
    if (error instanceof AssociatedRulesError) {
      const message = `Cannot delete provider with associated rules: ${error.rules.join(', ')}`;
      return res.boom.conflict(message);
    }
    throw error;
  }
}

// express routes
router.get('/:id', get);
router.put('/:id', put);
router.delete('/:id', del);
router.post('/', post);
router.get('/', list);

module.exports = router;
