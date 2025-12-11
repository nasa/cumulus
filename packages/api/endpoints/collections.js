//@ts-check

'use strict';

const router = require('express-promise-router')();
const {
  InvalidRegexError,
  UnmatchedRegexError,
  RecordDoesNotExist,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

// Import OpenTelemetry
const { trace } = require('@opentelemetry/api');

const {
  CollectionPgModel,
  createRejectableTransaction,
  getKnexClient,
  isCollisionError,
  translateApiCollectionToPostgresCollection,
  translatePostgresCollectionToApiCollection,
  CollectionSearch,
} = require('@cumulus/db');
const CollectionConfigStore = require('@cumulus/collection-config-store');
const {
  publishCollectionCreateSnsMessage,
  publishCollectionDeleteSnsMessage,
  publishCollectionUpdateSnsMessage,
} = require('../lib/publishSnsMessageUtils');
const { isBadRequestError } = require('../lib/errors');
const { validateCollection } = require('../lib/utils');
const insertMMTLinks = require('../lib/mmt');

const log = new Logger({ sender: '@cumulus/api/collections' });

// Get the tracer
const tracer = trace.getTracer('cumulus-api-collections');

/**
 * List all collections.
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function list(req, res) {
  return await tracer.startActiveSpan('collections.list', async (span) => {
    try {
      log.debug(`list query ${JSON.stringify(req.query)}`);
      const { getMMT, ...queryStringParameters } = req.query;

      span.setAttribute('collections.get_mmt', getMMT === 'true');
      span.setAttribute('collections.has_query_params', Object.keys(queryStringParameters).length > 0);

      const dbSearch = new CollectionSearch(
        { queryStringParameters }
      );
      let result = await dbSearch.query();

      span.setAttribute('collections.result_count', result?.meta?.count || 0);
      span.setAttribute('collections.results_returned', result?.results?.length || 0);

      if (getMMT === 'true') {
        await tracer.startActiveSpan('insertMMTLinks', async (mmtSpan) => {
          try {
            result = await insertMMTLinks(result);
          } finally {
            mmtSpan.end();
          }
        });
      }

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
 * List all collections with active granules
 * If time params are specified the query will return collections
 * that have granules that have been updated in that time frame.
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function activeList(req, res) {
  return await tracer.startActiveSpan('collections.activeList', async (span) => {
    try {
      log.debug(`activeList query ${JSON.stringify(req.query)}`);
      const { getMMT, ...queryStringParameters } = req.query;

      span.setAttribute('collections.active', true);
      span.setAttribute('collections.get_mmt', getMMT === 'true');
      span.setAttribute('collections.has_query_params', Object.keys(queryStringParameters).length > 0);

      const dbSearch = new CollectionSearch({ queryStringParameters: { active: 'true', ...queryStringParameters } });
      let result = await dbSearch.query();

      span.setAttribute('collections.result_count', result?.meta?.count || 0);
      span.setAttribute('collections.results_returned', result?.results?.length || 0);

      if (getMMT === 'true') {
        await tracer.startActiveSpan('insertMMTLinks', async (mmtSpan) => {
          try {
            result = await insertMMTLinks(result);
          } finally {
            mmtSpan.end();
          }
        });
      }

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
 * Query a single collection.
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function get(req, res) {
  return await tracer.startActiveSpan('collections.get', async (span) => {
    try {
      const name = req.params.name;
      const version = req.params.version;

      span.setAttribute('collection.name', name);
      span.setAttribute('collection.version', version);

      try {
        const collectionPgModel = new CollectionPgModel();
        const knex = await getKnexClient();

        const result = await tracer.startActiveSpan('collectionPgModel.get', async (dbSpan) => {
          try {
            return await collectionPgModel.get(knex, { name, version });
          } finally {
            dbSpan.end();
          }
        });

        return res.send(translatePostgresCollectionToApiCollection(result));
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('collection.not_found', true);
        }
        span.recordException(error);
        span.setAttribute('error', true);
        return res.boom.notFound(error.message);
      }
    } finally {
      span.end();
    }
  });
}

/**
 * Creates a new collection
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function post(req, res) {
  return await tracer.startActiveSpan('collections.post', async (span) => {
    try {
      const {
        collectionPgModel = new CollectionPgModel(),
        knex = await getKnexClient(),
        collectionConfigStore = new CollectionConfigStore(
          process.env.system_bucket,
          process.env.stackName
        ),
      } = req.testContext || {};

      const collection = req.body || {};

      const { name, version } = collection;

      span.setAttribute('collection.name', name);
      span.setAttribute('collection.version', version);

      if (!name || !version) {
        span.setAttribute('collection.missing_fields', true);
        return res.boom.badRequest(`Field name and/or version is missing in Collection payload ${JSON.stringify(collection)}`);
      }

      collection.updatedAt = Date.now();
      collection.createdAt = Date.now();

      validateCollection(collection);

      let translatedCollection;
      try {
        const dbRecord = translateApiCollectionToPostgresCollection(collection);

        try {
          await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
            try {
              await createRejectableTransaction(knex, async (trx) => {
                const [pgCollection] = await collectionPgModel.create(trx, dbRecord);
                translatedCollection
                  = await translatePostgresCollectionToApiCollection(pgCollection);

                await tracer.startActiveSpan('publishCollectionCreateSnsMessage', async (snsSpan) => {
                  try {
                    await publishCollectionCreateSnsMessage(translatedCollection);
                  } finally {
                    snsSpan.end();
                  }
                });
              });

              await tracer.startActiveSpan('collectionConfigStore.put', async (s3Span) => {
                try {
                  await collectionConfigStore.put(name, version, translatedCollection);
                } finally {
                  s3Span.end();
                }
              });
            } finally {
              txSpan.end();
            }
          });
        } catch (innerError) {
          if (isCollisionError(innerError)) {
            span.setAttribute('collection.collision', true);
            return res.boom.conflict(`A record already exists for name: ${name}, version: ${version}`);
          }
          throw innerError;
        }

        return res.send({
          message: 'Record saved',
          record: translatedCollection,
        });
      } catch (error) {
        if (
          isBadRequestError(error)
          || error instanceof InvalidRegexError
          || error instanceof UnmatchedRegexError
        ) {
          span.setAttribute('collection.validation_error', true);
          span.recordException(error);
          span.setAttribute('error', true);
          return res.boom.badRequest(error.message);
        }
        log.error(`Error occurred while trying to create collection: ${JSON.stringify(collection)}`, error);
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
 * Updates an existing collection
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function put(req, res) {
  return await tracer.startActiveSpan('collections.put', async (span) => {
    try {
      const {
        collectionPgModel = new CollectionPgModel(),
        knex = await getKnexClient(),
        collectionConfigStore = new CollectionConfigStore(
          process.env.system_bucket,
          process.env.stackName
        ),
      } = req.testContext || {};

      const { name, version } = req.params;
      const collection = req.body;

      span.setAttribute('collection.name', name);
      span.setAttribute('collection.version', version);

      validateCollection(collection);
      let oldPgCollection;
      let apiPgCollection;

      if (name !== collection.name || version !== collection.version) {
        span.setAttribute('collection.name_version_mismatch', true);
        return res.boom.badRequest('Expected collection name and version to be'
          + ` '${name}' and '${version}', respectively, but found '${collection.name}'`
          + ` and '${collection.version}' in payload`);
      }

      try {
        oldPgCollection = await tracer.startActiveSpan('collectionPgModel.get', async (dbSpan) => {
          try {
            return await collectionPgModel.get(knex, { name, version });
          } finally {
            dbSpan.end();
          }
        });
      } catch (error) {
        if (!(error instanceof RecordDoesNotExist)) {
          throw error;
        }
        span.setAttribute('collection.not_found', true);
        return res.boom.notFound(`Collection '${name}' version '${version}' not found`);
      }

      collection.updatedAt = Date.now();
      collection.createdAt = oldPgCollection.created_at.getTime();

      const postgresCollection = translateApiCollectionToPostgresCollection(collection);

      try {
        await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
          try {
            await createRejectableTransaction(knex, async (trx) => {
              const [pgCollection] = await collectionPgModel.upsert(trx, postgresCollection);
              apiPgCollection = translatePostgresCollectionToApiCollection(pgCollection);

              await tracer.startActiveSpan('publishCollectionUpdateSnsMessage', async (snsSpan) => {
                try {
                  await publishCollectionUpdateSnsMessage(apiPgCollection);
                } finally {
                  snsSpan.end();
                }
              });

              await tracer.startActiveSpan('collectionConfigStore.put', async (s3Span) => {
                try {
                  await collectionConfigStore.put(name, version, apiPgCollection);
                } finally {
                  s3Span.end();
                }
              });
            });
          } finally {
            txSpan.end();
          }
        });
      } catch (error) {
        log.debug(`Failed to update collection with name ${name}, version ${version} and payload ${JSON.stringify(collection)} . Error: ${JSON.stringify(error)}`);
        span.recordException(error);
        span.setAttribute('error', true);
        throw error;
      }

      return res.send(apiPgCollection);
    } finally {
      span.end();
    }
  });
}

/**
 * Delete a collection record
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function del(req, res) {
  return await tracer.startActiveSpan('collections.del', async (span) => {
    try {
      const {
        collectionPgModel = new CollectionPgModel(),
        knex = await getKnexClient(),
        collectionConfigStore = new CollectionConfigStore(
          process.env.system_bucket,
          process.env.stackName
        ),
      } = req.testContext || {};

      const { name, version } = req.params;

      span.setAttribute('collection.name', name);
      span.setAttribute('collection.version', version);

      try {
        await tracer.startActiveSpan('collectionPgModel.get', async (dbSpan) => {
          try {
            await collectionPgModel.get(knex, { name, version });
          } finally {
            dbSpan.end();
          }
        });
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          log.info(`Collection does not exist in PostgreSQL. Failed to delete collection with name ${name} and version ${version}`);
          span.setAttribute('collection.not_found', true);
          return res.boom.notFound('No record found');
        }
        throw error;
      }

      try {
        await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
          try {
            await createRejectableTransaction(knex, async (trx) => {
              await collectionPgModel.delete(trx, { name, version });

              await tracer.startActiveSpan('publishCollectionDeleteSnsMessage', async (snsSpan) => {
                try {
                  await publishCollectionDeleteSnsMessage({ name, version });
                } finally {
                  snsSpan.end();
                }
              });
            });
          } finally {
            txSpan.end();
          }
        });
      } catch (error) {
        log.debug(`Failed to delete collection with name ${name} and version ${version}. Error: ${JSON.stringify(error)}`);
        if (error.constraint === 'rules_collection_cumulus_id_foreign') {
          span.setAttribute('collection.has_associated_rules', true);
          const message = `Cannot delete collection with associated rules: ${error.detail}`;
          span.recordException(error);
          span.setAttribute('error', true);
          return res.boom.conflict(message);
        }
        span.recordException(error);
        span.setAttribute('error', true);
        throw error;
      }

      await tracer.startActiveSpan('collectionConfigStore.delete', async (s3Span) => {
        try {
          await collectionConfigStore.delete(name, version);
        } finally {
          s3Span.end();
        }
      });

      return res.send({ message: 'Record deleted' });
    } finally {
      span.end();
    }
  });
}

// express routes
router.get('/:name/:version', get);
router.put('/:name/:version', put);
router.delete('/:name/:version', del);
router.post('/', post);
router.get('/', list);
router.get('/active', activeList);

module.exports = {
  del,
  post,
  put,
  router,
};
