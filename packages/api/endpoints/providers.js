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

const Provider = require('../models/providers');
const { AssociatedRulesError, isBadRequestError } = require('../lib/errors');
const log = new Logger({ sender: '@cumulus/api/providers' });

/**
 * List all providers
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const table = 'providers';
  const queryParameters = req.query;
  const perPage = Number.parseInt((queryParameters.limit) ? queryParameters.limit : 10, 10)
  const currentPage = Number.parseInt((queryParameters.page) ? queryParameters.page : 1, 10);
  const knex = await getKnexClient();
  const response = await knex('providers').paginate({
    perPage,
    currentPage,
  });
  const results = response.data;
  const translatedResults = results.map((providerRecord) => translatePostgresProviderToApiProvider(providerRecord));

  const queryResults = {
    results: translatedResults,
    meta: {
      ...response.pagination,
      count: response.pagination.total,
      stack: process.env.stackName,
      page: response.pagination.currentPage,
      table,
      limit: 10,
    }
  };

  return res.send(queryResults);
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
    providerModel = new Provider(),
    providerPgModel = new ProviderPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const apiProvider = req.body;

  apiProvider.updatedAt = Date.now();
  apiProvider.createdAt = Date.now();

  const id = apiProvider.id;

  try {
    let record;
    if (!apiProvider.id) {
      throw new ValidationError('Provider records require an id');
    }

    const postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);
    validateProviderHost(apiProvider.host);

    try {
      await createRejectableTransaction(knex, async (trx) => {
        await providerPgModel.create(trx, postgresProvider);
        record = await providerModel.create(apiProvider);
        await indexProvider(esClient, record, process.env.ES_INDEX);
      });
    } catch (innerError) {
      // Clean up DynamoDB record in case of any failure
      await providerModel.delete(apiProvider);
      throw innerError;
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
async function put(req, res) {
  const {
    providerModel = new Provider(),
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

  let oldProvider;
  let oldPgProvider;

  try {
    oldPgProvider = await providerPgModel.get(knex, { name: id });
  } catch (error) {
    if (error.name !== 'RecordDoesNotExist') {
      throw error;
    }
    return res.boom.notFound(
      `Postgres provider with name/id '${id}' not found`
    );
  }

  try {
    oldProvider = await providerModel.get({ id });
  } catch (error) {
    if (error.name !== 'RecordDoesNotExist') {
      throw error;
    }
    log.warn(`Dynamo record for Provider ${id} not found, proceeding to update with PostgreSQL record alone`);
  }

  apiProvider.updatedAt = Date.now();
  apiProvider.createdAt = oldPgProvider.created_at.getTime();

  let record;
  const postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);

  try {
    await createRejectableTransaction(knex, async (trx) => {
      await providerPgModel.upsert(trx, postgresProvider);
      record = await providerModel.create(apiProvider);
      await indexProvider(esClient, record, process.env.ES_INDEX);
    });
  } catch (innerError) {
    // Revert Dynamo record update if any write fails
    if (oldProvider) {
      await providerModel.create(oldProvider);
    }
    throw innerError;
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
  const {
    providerModel = new Provider(),
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

  let existingProvider;
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
    // Save DynamoDB provider in case delete fails and need to recreate
    existingProvider = await providerModel.get({ id });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  try {
    try {
      await createRejectableTransaction(knex, async (trx) => {
        await providerPgModel.delete(trx, { name: id });
        await providerModel.delete({ id });
        await deleteProvider({
          esClient,
          id,
          index: process.env.ES_INDEX,
          ignore: [404],
        });
      });
    } catch (innerError) {
      // Delete is idempotent, so there may not be a DynamoDB
      // record to recreate
      if (existingProvider) {
        await providerModel.create(existingProvider);
      }
      throw innerError;
    }
    return res.send({ message: 'Record deleted' });
  } catch (error) {
    if (error instanceof AssociatedRulesError || error.constraint === 'rules_provider_cumulus_id_foreign') {
      const messageDetail = error.rules || [error.detail];
      const message = `Cannot delete provider with associated rules: ${messageDetail.join(', ')}`;
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
