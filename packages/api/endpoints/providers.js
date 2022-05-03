'use strict';

const router = require('express-promise-router')();

const {
  createRejectableTransaction,
  getKnexClient,
  isCollisionError,
  ProviderPgModel,
  translateApiProviderToPostgresProvider,
  translatePostgresProviderToApiProvider,
  validateProviderHost,
} = require('@cumulus/db');
const {
  RecordDoesNotExist,
  ValidationError,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const { Search } = require('@cumulus/es-client/search');
const { indexProvider, deleteProvider } = require('@cumulus/es-client/indexer');
const { removeNilProperties } = require('@cumulus/common/util');

const { isBadRequestError } = require('../lib/errors');
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
  const knex = await getKnexClient({ env: process.env });
  const providerPgModel = new ProviderPgModel();

  let result;
  try {
    const providerRecord = await providerPgModel.get(knex, { name: id });
    result = translatePostgresProviderToApiProvider(providerRecord);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) return res.boom.notFound(`Provider ${id} not found.`);
    throw error;
  }
  return res.send(removeNilProperties(result));
}

/**
 * Creates a new provider
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const {
    providerPgModel = new ProviderPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const apiProvider = req.body;

  apiProvider.updatedAt = Date.now();
  apiProvider.createdAt = Date.now();

  const id = apiProvider.id;

  let postgresProvider;
  try {
    let record;
    if (!apiProvider.id) {
      throw new ValidationError('Provider records require an id');
    }
    postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);
    validateProviderHost(apiProvider.host);

    await createRejectableTransaction(knex, async (trx) => {
      const [updatedPostgresProvider] = await providerPgModel.create(trx, postgresProvider, '*');
      record = translatePostgresProviderToApiProvider(updatedPostgresProvider);
      await indexProvider(esClient, record, process.env.ES_INDEX);
    });
    return res.send({ record, message: 'Record saved' });
  } catch (error) {
    if (isCollisionError(error)) {
      return res.boom.conflict(`A record already exists for ${id}`);
    }
    if (isBadRequestError(error)) {
      return res.boom.badRequest(error.message);
    }
    log.error('Error occurred while trying to create provider:', error);
    log.error(`Error occurred with user input provider: ${JSON.stringify(apiProvider)}`);
    log.error(`Error occurred with translated postgres provider: ${JSON.stringify(postgresProvider)}`);
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
async function put(req, res) {
  const {
    providerPgModel = new ProviderPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const { params: { id }, body } = req;

  const apiProvider = body;

  if (id !== apiProvider.id) {
    return res.boom.badRequest(
      `Expected provider ID to be '${id}', but found '${body.id}' in payload`
    );
  }

  let existingPgProvider;

  try {
    existingPgProvider = await providerPgModel.get(knex, { name: id });
  } catch (error) {
    if (error.name !== 'RecordDoesNotExist') {
      throw error;
    }
    return res.boom.notFound(
      `Postgres provider with name/id '${id}' not found`
    );
  }

  apiProvider.updatedAt = Date.now();
  apiProvider.createdAt = existingPgProvider.created_at.getTime();

  let record;
  const postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);

  await createRejectableTransaction(knex, async (trx) => {
    const [updatedPostgresProvider] = await providerPgModel.upsert(trx, postgresProvider);
    record = translatePostgresProviderToApiProvider(updatedPostgresProvider);
    await indexProvider(esClient, record, process.env.ES_INDEX);
  });

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
  const {
    providerPgModel = new ProviderPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const { id } = req.params;
  const esProvidersClient = new Search(
    {},
    'provider',
    process.env.ES_INDEX
  );

  try {
    await providerPgModel.get(knex, { name: id });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (!(await esProvidersClient.exists(id))) {
        log.info('Provider does not exist in Elasticsearch and PostgreSQL');
        return res.boom.notFound('No record found');
      }
      log.info('Provider does not exist in PostgreSQL, it only exists in Elasticsearch. Proceeding with deletion');
    } else {
      throw error;
    }
  }

  try {
    await createRejectableTransaction(knex, async (trx) => {
      await providerPgModel.delete(trx, { name: id });
      await deleteProvider({
        esClient,
        id,
        index: process.env.ES_INDEX,
        ignore: [404],
      });
    });
    log.debug(`deleted provider ${id}`);
    return res.send({ message: 'Record deleted' });
  } catch (error) {
    if (error.constraint === 'rules_provider_cumulus_id_foreign') {
      const message = `Cannot delete provider with associated rules: ${error.detail}`;
      return res.boom.conflict(message);
    }
    if (error.constraint === 'granules_provider_cumulus_id_foreign') {
      const message = `Cannot delete provider ${req.params.id} with associated granules.`;
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

module.exports = {
  del,
  post,
  put,
  router,
};
