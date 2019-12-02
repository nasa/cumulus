'use strict';

const router = require('express-promise-router')();
const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/common/errors');
const models = require('../models');
const { AssociatedRulesError } = require('../lib/errors');
const { Search } = require('../es/search');
const { addToLocalES, indexProvider } = require('../es/indexer');

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
  } catch (e) {
    if (e instanceof RecordDoesNotExist) {
      const record = await providerModel.create(data);

      if (inTestMode()) {
        await addToLocalES(record, indexProvider);
      }
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
async function put({ params: { id }, body }, res) {
  if (id !== body.id) {
    return res.boom.badRequest(
      `Expected provider ID to be '${id}', but found '${body.id}' in payload`
    );
  }

  const providerModel = new models.Provider();

  return (!(await providerModel.exists(id)))
    ? res.boom.notFound(`Provider with ID '${id}' not found`)
    : providerModel.create(body)
      .then((record) => (
        inTestMode()
          ? addToLocalES(record, indexProvider).then(() => record)
          : record
      ))
      .then((record) => res.send(record));
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

    if (inTestMode()) {
      const esClient = await Search.es(process.env.ES_HOST);
      const esIndex = process.env.esIndex;
      await esClient.delete({
        id: req.params.id,
        type: 'provider',
        index: esIndex
      }, { ignore: [404] });
    }
    return res.send({ message: 'Record deleted' });
  } catch (err) {
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
