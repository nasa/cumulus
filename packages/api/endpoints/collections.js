//@ts-check

'use strict';

const router = require('express-promise-router')();
const {
  InvalidRegexError,
  UnmatchedRegexError,
  RecordDoesNotExist,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

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

/**
 * List all collections.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  log.debug(`list query ${JSON.stringify(req.query)}`);
  const { getMMT, ...queryStringParameters } = req.query;
  const dbSearch = new CollectionSearch(
    { queryStringParameters }
  );
  let result = await dbSearch.query();
  if (getMMT === 'true') {
    result = await insertMMTLinks(result);
  }
  return res.send(result);
}

/**
 * List all collections with active granules
 * If time params are specified the query will return collections
 * that have granules that have been updated in that time frame.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function activeList(req, res) {
  log.debug(`activeList query ${JSON.stringify(req.query)}`);
  const { getMMT, ...queryStringParameters } = req.query;
  const dbSearch = new CollectionSearch({ queryStringParameters: { active: 'true', ...queryStringParameters } });
  let result = await dbSearch.query();
  if (getMMT === 'true') {
    result = await insertMMTLinks(result);
  }
  return res.send(result);
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
    const collectionPgModel = new CollectionPgModel();
    const knex = await getKnexClient();
    const result = await collectionPgModel.get(knex, { name, version });
    return res.send(translatePostgresCollectionToApiCollection(result));
  } catch (error) {
    return res.boom.notFound(error.message);
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
  if (!name || !version) {
    return res.boom.badRequest(`Field name and/or version is missing in Collection payload ${JSON.stringify(collection)}`);
  }

  collection.updatedAt = Date.now();
  collection.createdAt = Date.now();

  validateCollection(collection);

  let translatedCollection;
  try {
    const dbRecord = translateApiCollectionToPostgresCollection(collection);

    try {
      await createRejectableTransaction(knex, async (trx) => {
        const [pgCollection] = await collectionPgModel.create(trx, dbRecord);
        translatedCollection = await translatePostgresCollectionToApiCollection(pgCollection);
        await publishCollectionCreateSnsMessage(translatedCollection);
      });
      await collectionConfigStore.put(name, version, translatedCollection);
    } catch (innerError) {
      if (isCollisionError(innerError)) {
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
      return res.boom.badRequest(error.message);
    }
    log.error(`Error occurred while trying to create collection: ${JSON.stringify(collection)}`, error);
    return res.boom.badImplementation(error.message);
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
  validateCollection(collection);
  let oldPgCollection;
  let apiPgCollection;

  if (name !== collection.name || version !== collection.version) {
    return res.boom.badRequest('Expected collection name and version to be'
      + ` '${name}' and '${version}', respectively, but found '${collection.name}'`
      + ` and '${collection.version}' in payload`);
  }

  try {
    oldPgCollection = await collectionPgModel.get(knex, { name, version });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
    return res.boom.notFound(`Collection '${name}' version '${version}' not found`);
  }
  collection.updatedAt = Date.now();
  collection.createdAt = oldPgCollection.created_at.getTime();

  const postgresCollection = translateApiCollectionToPostgresCollection(collection);

  try {
    await createRejectableTransaction(knex, async (trx) => {
      const [pgCollection] = await collectionPgModel.upsert(trx, postgresCollection);
      apiPgCollection = translatePostgresCollectionToApiCollection(pgCollection);
      await publishCollectionUpdateSnsMessage(apiPgCollection);
      await collectionConfigStore.put(name, version, apiPgCollection);
    });
  } catch (error) {
    log.debug(`Failed to update collection with name ${name}, version ${version} and payload ${JSON.stringify(collection)} . Error: ${JSON.stringify(error)}`);
    throw error;
  }

  return res.send(apiPgCollection);
}

/**
 * Delete a collection record
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
    collectionConfigStore = new CollectionConfigStore(
      process.env.system_bucket,
      process.env.stackName
    ),
  } = req.testContext || {};

  const { name, version } = req.params;

  try {
    await collectionPgModel.get(knex, { name, version });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.info(`Collection does not exist in PostgreSQL. Failed to delete collection with name ${name} and version ${version}`);
      return res.boom.notFound('No record found');
    }
    throw error;
  }

  try {
    await createRejectableTransaction(knex, async (trx) => {
      await collectionPgModel.delete(trx, { name, version });
      await publishCollectionDeleteSnsMessage({ name, version });
    });
  } catch (error) {
    log.debug(`Failed to delete collection with name ${name} and version ${version}. Error: ${JSON.stringify(error)}`);
    if (error.constraint === 'rules_collection_cumulus_id_foreign') {
      const message = `Cannot delete collection with associated rules: ${error.detail}`;
      return res.boom.conflict(message);
    }
    throw error;
  }

  await collectionConfigStore.delete(name, version);

  return res.send({ message: 'Record deleted' });
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
