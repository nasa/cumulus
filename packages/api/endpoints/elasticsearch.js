'use strict';

const router = require('express-promise-router')();
const get = require('lodash/get');

const log = require('@cumulus/common/log');

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const { AsyncOperation } = require('../models');
const { IndexExistsError } = require('../lib/errors');
const { Search } = require('../es/search');
const { createIndex } = require('../es/indexer');
const { getEsTypes, getIndexNameForType, getAliasByType } = require('../es/types');

// const snapshotRepoName = 'cumulus-es-snapshots';

function timestampedIndexName() {
  const date = new Date();
  return `cumulus-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

async function createEsSnapshot(req, res) {
  return res.boom.badRequest('Functionality not yet implemented');

  // *** Currently blocked on NGAP ****
  // const esClient = await Search.es();

  //let repository = null;

  // try {
  //   const repository = await esClient.snapshot.getRepository({ repository: snapshotRepoName });
  // }
  // catch (err) {
  //   // Handle repository missing exceptions
  //   if (!err.message.includes('[repository_missing_exception]')) {
  //     throw err;
  //   }

  // TO DO: when permission boundaries are updated
  // repository = await esClient.snapshot.createRepository({
  //   repository: snapshotRepoName,
  //   verify: false,
  //   body: {
  //     type: 's3',
  //     settings: {
  //       bucket: 'lf-internal',
  //       region: 'us-east-1',
  //       role_arn: process.env.ROLE_ARN
  //     }
  //   }
  // });
  // }
}

async function initIndexForReindex(type, esClient, alias, source, dest) {
  const aliasName = getAliasByType(type, alias);
  let sourceIndex = source;

  const indexAlias = await esClient.indices.getAlias({
    name: aliasName
  }).then((response) => response.body);

  // alias keys = index name
  const indices = Object.keys(indexAlias);

  if (!sourceIndex) {
    if (indices.length > 1) {
      // We don't know which index to use as the source, throw error
      throw new Error(`Multiple indices found for alias ${aliasName}. Specify source index as one of [${indices.sort().join(', ')}].`);
    }

    sourceIndex = indices[0];
  } else {
    sourceIndex = getIndexNameForType(type, sourceIndex);
    const sourceExists = await esClient.indices.exists({ index: sourceIndex })
      .then((response) => response.body);

    if (!sourceExists) {
      throw new Error(`Source index ${sourceIndex} does not exist.`);
    }

    if (indices.includes(sourceIndex) === false) {
      throw new Error(`Source index ${sourceIndex} is not aliased with alias ${aliasName}.`);
    }
  }

  const destIndex = getIndexNameForType(type, dest);
  try {
    await createIndex(esClient, type, destIndex);
  } catch (error) {
    if (error instanceof IndexExistsError) {
      throw new TypeError(`Destination index ${destIndex} exists. Please specify an index name that does not exist.`);
    }

    log.error(JSON.stringify(error));
    throw new Error(`Error creating index ${destIndex}: ${error.message}`);
  }

  return { sourceIndex, destIndex };
}

async function reindex(req, res) {
  const sourceIndex = req.body.sourceIndex;
  const destIndex = req.body.destIndex || timestampedIndexName();

  const aliasName = req.body.aliasName;

  const esClient = await Search.es();

  const esTypes = getEsTypes();

  // Check the validity of the alias and sourceIndex for each type before we kick off the reindex,
  // create the destination indices
  let indices;

  try {
    indices = await Promise.all(esTypes.map((type) =>
      initIndexForReindex(type, esClient, aliasName, sourceIndex, destIndex)));
  } catch (error) {
    return res.boom.badRequest(get(error, 'meta.body.error') || error.message);
  }

  // reindex
  await Promise.all(indices.map((index) =>
    esClient.reindex({
      body: {
        source: { index: index.sourceIndex },
        dest: { index: index.destIndex }
      }
    })));

  const reindexes = indices.map((index) => `${index.sourceIndex} to ${index.destIndex}`);

  const message = `Reindexing ${reindexes.join(', ')}. Check the reindex-status endpoint for status.`;

  return res.status(200).send({ message });
}

async function reindexStatus(req, res) {
  const esClient = await Search.es();

  const reindexTaskStatus = await esClient.tasks.list({ actions: ['*reindex'] })
    .then((response) => response.body);

  await esClient.indices.refresh();

  const indexStatus = await esClient.indices.stats({
    metric: 'docs'
  }).then((response) => response.body);

  const status = {
    reindexStatus: reindexTaskStatus,
    indexStatus
  };

  return res.send(status);
}

async function changeIndex(req, res) {
  const deleteSource = req.body.deleteSource;

  // LAUREN TO DO
  const aliasName = req.body.aliasName || getAliasByType(undefined);
  const currentIndex = req.body.currentIndex;
  const newIndex = req.body.newIndex;

  const esClient = await Search.es();

  if (!currentIndex || !newIndex) {
    return res.boom.badRequest('Please explicity specify a current and new index.');
  }

  if (currentIndex === newIndex) {
    return res.boom.badRequest('The current index cannot be the same as the new index.');
  }

  const currentExists = await esClient.indices.exists({ index: currentIndex })
    .then((response) => response.body);

  if (!currentExists) {
    return res.boom.badRequest(`Current index ${currentIndex} does not exist.`);
  }

  const destExists = await esClient.indices.exists({ index: newIndex })
    .then((response) => response.body);

  if (!destExists) {
    return res.boom.badRequest(`New index ${newIndex} does not exist.`);
  }

  try {
    await esClient.indices.updateAliases({
      body: {
        actions: [
          { remove: { index: currentIndex, alias: aliasName } },
          { add: { index: newIndex, alias: aliasName } }
        ]
      }
    });

    log.info(`Removed alias ${aliasName} from index ${currentIndex} and added alias to ${newIndex}`);
  } catch (error) {
    return res.boom.badRequest(
      `Error removing alias ${aliasName} from index ${currentIndex} and adding alias to ${newIndex}: ${error}`
    );
  }

  let message = `Change index success - alias ${aliasName} now pointing to ${newIndex}`;

  if (deleteSource) {
    await esClient.indices.delete({ index: currentIndex });
    log.info(`Deleted index ${currentIndex}`);
    message = `${message} and index ${currentIndex} deleted`;
  }

  return res.send({ message });
}

async function indicesStatus(req, res) {
  const esClient = await Search.es();

  return res.send(await esClient.cat.indices({}));
}

async function indexFromDatabase(req, res) {
  const esClient = await Search.es();

  const indexName = req.body.indexName || timestampedIndexName();

  // LAUREN TO DO
  await createIndex(esClient, undefined, indexName)
    .catch((error) => {
      if (!(error instanceof IndexExistsError)) throw error;
    });

  const asyncOperationModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
    tableName: process.env.AsyncOperationsTable
  });

  const asyncOperation = await asyncOperationModel.start({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    lambdaName: process.env.IndexFromDatabaseLambda,
    description: 'Elasticsearch index from database',
    operationType: 'ES Index',
    payload: {
      indexName,
      tables: {
        collectionsTable: process.env.CollectionsTable,
        executionsTable: process.env.ExecutionsTable,
        granulesTable: process.env.GranulesTable,
        pdrsTable: process.env.PdrsTable,
        providersTable: process.env.ProvidersTable,
        reconciliationReportsTable: process.env.ReconciliationReportsTable,
        rulesTable: process.env.RulesTable,
        asyncOperationsTable: process.env.AsyncOperationsTable
      },
      esHost: process.env.ES_HOST,
      esRequestConcurrency: process.env.ES_CONCURRENCY
    }
  });

  return res.send({ message: `Indexing database to ${indexName}. Operation id: ${asyncOperation.id}` });
}

async function getCurrentIndex(req, res) {
  const esClient = await Search.es();

  // LAUREN TO DO
  const alias = req.params.alias || getAliasByType(undefined);

  const aliasIndices = await esClient.indices.getAlias({ name: alias })
    .then((response) => response.body);

  return res.send(Object.keys(aliasIndices));
}

// express routes
router.put('/create-snapshot', createEsSnapshot);
router.post('/reindex', reindex);
router.get('/reindex-status', reindexStatus);
router.post('/change-index', changeIndex);
router.post('/index-from-database', indexFromDatabase, asyncOperationEndpointErrorHandler);
router.get('/indices-status', indicesStatus);
router.get('/current-index/:alias', getCurrentIndex);
router.get('/current-index', getCurrentIndex);

module.exports = router;
