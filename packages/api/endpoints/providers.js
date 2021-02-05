'use strict';

const router = require('express-promise-router')();

const {
  getKnexClient,
  ProviderPgModel,
  tableNames,
  translateApiProviderToPostgresProvider,
  validateProviderHost,
} = require('@cumulus/db');
const { inTestMode } = require('@cumulus/common/test-utils');
const {
  ApiCollisionError,
  RecordDoesNotExist,
  ValidationError,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const Provider = require('../models/providers');
const { AssociatedRulesError, isBadRequestError } = require('../lib/errors');
const { Search } = require('../es/search');
const { addToLocalES, indexProvider } = require('../es/indexer');

const log = new Logger({ sender: '@cumulus/api/providers' });

// Postgres error codes:
// https://www.postgresql.org/docs/10/errcodes-appendix.html
const isCollisionError = (error) => (error instanceof ApiCollisionError || error.code === '23505');

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

async function throwIfDynamoRecordExists(providerModel, id) {
  try {
    await providerModel.get({ id });
    throw new ApiCollisionError(`Dynamo record id ${id} exists`);
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }
}

/**
 * Creates a new provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const apiProvider = req.body;

  apiProvider.updatedAt = Date.now();
  apiProvider.createdAt = Date.now();

  const id = apiProvider.id;
  const providerModel = new Provider();
  const knex = await getKnexClient({ env: process.env });
  const providerPgModel = new ProviderPgModel();
  try {
    let record;
    if (!apiProvider.id) {
      throw new ValidationError('Provider records require an id');
    }
    await throwIfDynamoRecordExists(providerModel, id);
    const postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);
    validateProviderHost(apiProvider.host);

    await knex.transaction(async (trx) => {
      await providerPgModel.create(trx, postgresProvider);
      record = await providerModel.create(apiProvider);
    });

    if (inTestMode()) {
      await addToLocalES(record, indexProvider);
    }
    return res.send({ record, message: 'Record saved' });
  } catch (error) {
    if (isCollisionError(error)) {
      return res.boom.conflict(`A record already exists for ${id}`);
    }

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
  const apiProvider = body;

  if (id !== apiProvider.id) {
    return res.boom.badRequest(
      `Expected provider ID to be '${id}', but found '${body.id}' in payload`
    );
  }

  const knex = await getKnexClient();
  const providerModel = new Provider();
  const providerPgModel = new ProviderPgModel();

  let oldProvider;
  try {
    oldProvider = await providerModel.get({ id });
  } catch (error) {
    if (error.name !== 'RecordDoesNotExist') {
      throw error;
    }
    return res.boom.notFound(
      `Provider with ID '${id}' not found`
    );
  }
  apiProvider.updatedAt = Date.now();
  apiProvider.createdAt = oldProvider.createdAt;

  let record;
  const postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);

  await knex.transaction(async (trx) => {
    await providerPgModel.upsert(trx, postgresProvider);
    record = await providerModel.create(apiProvider);
  });

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
  const knex = await getKnexClient({ env: process.env });

  try {
    return knex.transaction(async (trx) => {
      await trx(tableNames.providers).where({ name: req.params.id }).del();
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
    });
  } catch (error) {
    if (error instanceof AssociatedRulesError || error.constraint === 'rules_provider_cumulus_id_foreign') {
      const messageDetail = error.rules || [error.detail];
      const message = `Cannot delete provider with associated rules: ${messageDetail.join(', ')}`;
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
