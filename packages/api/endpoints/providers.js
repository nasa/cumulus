'use strict';

const router = require('express-promise-router')();

// Import OpenTelemetry
const { trace } = require('@opentelemetry/api');

const {
  createRejectableTransaction,
  getKnexClient,
  isCollisionError,
  ProviderPgModel,
  translateApiProviderToPostgresProvider,
  translatePostgresProviderToApiProvider,
  validateProviderHost,
  ProviderSearch,
} = require('@cumulus/db');
const {
  RecordDoesNotExist,
  ValidationError,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const { removeNilProperties } = require('@cumulus/common/util');

const { isBadRequestError } = require('../lib/errors');
const log = new Logger({ sender: '@cumulus/api/providers' });

// Get the tracer
const tracer = trace.getTracer('cumulus-api-providers');

/**
 * List all providers
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function list(req, res) {
  return await tracer.startActiveSpan('providers.list', async (span) => {
    try {
      span.setAttribute('providers.has_query_params', Object.keys(req.query).length > 0);

      const dbSearch = new ProviderSearch(
        { queryStringParameters: req.query }
      );
      const result = await dbSearch.query();

      span.setAttribute('providers.result_count', result?.meta?.count || 0);
      span.setAttribute('providers.results_returned', result?.results?.length || 0);

      return res.send(result);
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Query a single provider
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function get(req, res) {
  return await tracer.startActiveSpan('providers.get', async (span) => {
    try {
      const id = req.params.id;

      span.setAttribute('provider.id', id);

      const knex = await getKnexClient({ env: process.env });
      const providerPgModel = new ProviderPgModel();

      let result;
      try {
        const providerRecord = await tracer.startActiveSpan('providerPgModel.get', async (dbSpan) => {
          try {
            return await providerPgModel.get(knex, { name: id });
          } finally {
            dbSpan.end();
          }
        });
        result = translatePostgresProviderToApiProvider(providerRecord);
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('provider.not_found', true);
          return res.boom.notFound(`Provider ${id} not found.`);
        }
        throw error;
      }

      return res.send(removeNilProperties(result));
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Creates a new provider
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function post(req, res) {
  return await tracer.startActiveSpan('providers.post', async (span) => {
    try {
      const {
        providerPgModel = new ProviderPgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      const apiProvider = req.body;

      apiProvider.updatedAt = Date.now();
      apiProvider.createdAt = Date.now();

      const id = apiProvider.id;

      span.setAttribute('provider.id', id);
      span.setAttribute('provider.protocol', apiProvider.protocol);
      span.setAttribute('provider.host', apiProvider.host);

      let postgresProvider;
      try {
        let record;
        if (!apiProvider.id) {
          span.setAttribute('provider.missing_id', true);
          throw new ValidationError('Provider records require an id');
        }

        postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);
        validateProviderHost(apiProvider.host);

        await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
          try {
            await createRejectableTransaction(knex, async (trx) => {
              const [updatedPostgresProvider] = await providerPgModel.create(trx, postgresProvider, '*');
              record = translatePostgresProviderToApiProvider(updatedPostgresProvider);
            });
          } finally {
            txSpan.end();
          }
        });

        return res.send({ record, message: 'Record saved' });
      } catch (error) {
        if (isCollisionError(error)) {
          span.setAttribute('provider.collision', true);
          span.recordException(error);
          span.setAttribute('error', true);
          return res.boom.conflict(`A record already exists for ${id}`);
        }
        if (isBadRequestError(error)) {
          span.setAttribute('provider.validation_error', true);
          span.recordException(error);
          span.setAttribute('error', true);
          return res.boom.badRequest(error.message);
        }
        log.error('Error occurred while trying to create provider:', error);
        log.error(`Error occurred with user input provider: ${JSON.stringify(apiProvider)}`);
        log.error(`Error occurred with translated postgres provider: ${JSON.stringify(postgresProvider)}`);
        span.recordException(error);
        span.setAttribute('error', true);
        return res.boom.badImplementation(error.message);
      }
    } finally {
      span.end();
    }
  });
}

/**
 * Updates an existing provider
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function put(req, res) {
  return await tracer.startActiveSpan('providers.put', async (span) => {
    try {
      const {
        providerPgModel = new ProviderPgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      const { params: { id }, body } = req;

      const apiProvider = body;

      span.setAttribute('provider.id', id);
      span.setAttribute('provider.protocol', apiProvider.protocol);
      span.setAttribute('provider.host', apiProvider.host);

      if (id !== apiProvider.id) {
        span.setAttribute('provider.id_mismatch', true);
        return res.boom.badRequest(
          `Expected provider ID to be '${id}', but found '${body.id}' in payload`
        );
      }

      let existingPgProvider;

      try {
        existingPgProvider = await tracer.startActiveSpan('providerPgModel.get', async (dbSpan) => {
          try {
            return await providerPgModel.get(knex, { name: id });
          } finally {
            dbSpan.end();
          }
        });
      } catch (error) {
        if (error.name !== 'RecordDoesNotExist') {
          throw error;
        }
        span.setAttribute('provider.not_found', true);
        return res.boom.notFound(
          `Postgres provider with name/id '${id}' not found`
        );
      }

      apiProvider.updatedAt = Date.now();
      apiProvider.createdAt = existingPgProvider.created_at.getTime();

      let record;
      const postgresProvider = await translateApiProviderToPostgresProvider(apiProvider);

      await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
        try {
          await createRejectableTransaction(knex, async (trx) => {
            const [updatedPostgresProvider] = await providerPgModel.upsert(trx, postgresProvider);
            record = translatePostgresProviderToApiProvider(updatedPostgresProvider);
          });
        } finally {
          txSpan.end();
        }
      });

      return res.send(record);
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Delete a provider
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function del(req, res) {
  return await tracer.startActiveSpan('providers.del', async (span) => {
    try {
      const {
        providerPgModel = new ProviderPgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      const { id } = req.params;

      span.setAttribute('provider.id', id);

      try {
        await tracer.startActiveSpan('providerPgModel.get', async (dbSpan) => {
          try {
            await providerPgModel.get(knex, { name: id });
          } finally {
            dbSpan.end();
          }
        });
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          log.info('Provider does not exist in PostgreSQL');
          span.setAttribute('provider.not_found', true);
          return res.boom.notFound('No record found');
        }
        throw error;
      }

      try {
        await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
          try {
            await createRejectableTransaction(knex, async (trx) => {
              await providerPgModel.delete(trx, { name: id });
            });
          } finally {
            txSpan.end();
          }
        });

        log.debug(`deleted provider ${id}`);
        return res.send({ message: 'Record deleted' });
      } catch (error) {
        if (error.constraint === 'rules_provider_cumulus_id_foreign') {
          span.setAttribute('provider.has_associated_rules', true);
          span.recordException(error);
          span.setAttribute('error', true);
          const message = `Cannot delete provider with associated rules: ${error.detail}`;
          return res.boom.conflict(message);
        }
        if (error.constraint === 'granules_provider_cumulus_id_foreign') {
          span.setAttribute('provider.has_associated_granules', true);
          span.recordException(error);
          span.setAttribute('error', true);
          const message = `Cannot delete provider ${req.params.id} with associated granules.`;
          return res.boom.conflict(message);
        }
        throw error;
      }
    } finally {
      span.end();
    }
  });
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
