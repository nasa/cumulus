'use strict';

const router = require('express-promise-router')();
const { v4: uuidv4 } = require('uuid');

const log = require('@cumulus/common/log');
const { IndexExistsError } = require('@cumulus/errors');
const { defaultIndexAlias, getEsClient } = require('@cumulus/es-client/search');
const { createIndex } = require('@cumulus/es-client/indexer');

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const { getFunctionNameFromRequestContext } = require('../lib/request');
const startAsyncOperation = require('../lib/startAsyncOperation');

// const snapshotRepoName = 'cumulus-es-snapshots';

function timestampedIndexName() {
  const date = new Date();
  return `cumulus-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function createEsSnapshot(req, res) {
  return res.boom.badRequest('Functionality not yet implemented');
}

async function reindex(req, res) {
  let sourceIndex = req.body.sourceIndex;
  let destIndex = req.body.destIndex;
  const aliasName = req.body.aliasName || defaultIndexAlias;

  const esClient = await getEsClient();

  if (!sourceIndex) {
    const alias = await esClient.client.indices.getAlias({
      name: aliasName,
    }).then((response) => response.body);

    // alias keys = index name
    const indices = Object.keys(alias);

    if (indices.length > 1) {
      // We don't know which index to use as the source, throw error
      return res.boom.badRequest(`Multiple indices found for alias ${aliasName}. Specify source index as one of [${indices.sort().join(', ')}].`);
    }

    sourceIndex = indices[0];
  } else {
    const sourceExists = await esClient.client.indices.exists({ index: sourceIndex })
      .then((response) => response.body);

    if (!sourceExists) {
      return res.boom.badRequest(`Source index ${sourceIndex} does not exist.`);
    }
  }

  if (!destIndex) {
    destIndex = timestampedIndexName();
  }

  if (sourceIndex === destIndex) {
    return res.boom.badRequest(`source index(${sourceIndex}) and destination index(${destIndex}) must be different.`);
  }

  const destExists = await esClient.client.indices.exists({ index: destIndex })
    .then((response) => response.body);

  if (!destExists) {
    try {
      await createIndex(esClient, destIndex);
      log.info(`Created destination index ${destIndex}.`);
    } catch (error) {
      return res.boom.badRequest(`Error creating index ${destIndex}: ${error.message}`);
    }
  }c

  // reindex
  esClient.client.reindex({
    body: {
      source: { index: sourceIndex },
      dest: { index: destIndex },
    },
  });

  const message = `Reindexing to ${destIndex} from ${sourceIndex}. Check the reindex-status endpoint for status.`;

  return res.status(200).send({ message });
}

async function reindexStatus(req, res) {
  const esClient = await getEsClient();

  const reindexTaskStatus = await esClient.client.tasks.list({ actions: ['*reindex'] })
    .then((response) => response.body);

  await esClient.client.indices.refresh();

  const indexStatus = await esClient.client.indices.stats({
    metric: 'docs',
  }).then((response) => response.body);

  const status = {
    reindexStatus: reindexTaskStatus,
    indexStatus,
  };

  return res.send(status);
}

async function changeIndex(req, res) {
  const deleteSource = req.body.deleteSource;
  const aliasName = req.body.aliasName || defaultIndexAlias;
  const currentIndex = req.body.currentIndex;
  const newIndex = req.body.newIndex;

  const esClient = await getEsClient();

  if (!currentIndex || !newIndex) {
    return res.boom.badRequest('Please explicity specify a current and new index.');
  }

  if (currentIndex === newIndex) {
    return res.boom.badRequest('The current index cannot be the same as the new index.');
  }

  const currentExists = await esClient.client.indices.exists({ index: currentIndex })
    .then((response) => response.body);

  if (!currentExists) {
    return res.boom.badRequest(`Current index ${currentIndex} does not exist.`);
  }

  const destExists = await esClient.client.indices.exists({ index: newIndex })
    .then((response) => response.body);

  if (!destExists) {
    try {
      await createIndex(esClient, newIndex);
      log.info(`Created destination index ${newIndex}.`);
    } catch (error) {
      return res.boom.badRequest(`Error creating index ${newIndex}: ${error.message}`);
    }
  }

  try {
    await esClient.client.indices.updateAliases({
      body: {
        actions: [
          { remove: { index: currentIndex, alias: aliasName } },
          { add: { index: newIndex, alias: aliasName } },
        ],
      },
    });

    log.info(`Removed alias ${aliasName} from index ${currentIndex} and added alias to ${newIndex}`);
  } catch (error) {
    return res.boom.badRequest(
      `Error removing alias ${aliasName} from index ${currentIndex} and adding alias to ${newIndex}: ${error}`
    );
  }

  let message = `Change index success - alias ${aliasName} now pointing to ${newIndex}`;

  if (deleteSource) {
    await esClient.client.indices.delete({ index: currentIndex });
    log.info(`Deleted index ${currentIndex}`);
    message = `${message} and index ${currentIndex} deleted`;
  }

  return res.send({ message });
}

async function indicesStatus(req, res) {
  const esClient = await getEsClient();

  return res.send(await esClient.client.cat.indices({}));
}

async function indexFromDatabase(req, res) {
  const esClient = await getEsClient();
  const indexName = req.body.indexName || timestampedIndexName();
  const { postgresResultPageSize, postgresConnectionPoolSize, esRequestConcurrency } = req.body;

  await createIndex(esClient, indexName)
    .catch((error) => {
      if (!(error instanceof IndexExistsError)) throw error;
    });

  const asyncOperationId = uuidv4();
  const asyncOperationEvent = {
    asyncOperationId,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.IndexFromDatabaseLambda,
    description: 'Elasticsearch index from database',
    operationType: 'ES Index',
    payload: {
      indexName,
      reconciliationReportsTable: process.env.ReconciliationReportsTable,
      esHost: process.env.ES_HOST,
      esRequestConcurrency: esRequestConcurrency || process.env.ES_CONCURRENCY,
      postgresResultPageSize,
      postgresConnectionPoolSize,
    },
  };

  log.debug(`About to invoke lambda to start async operation ${asyncOperationId}`);
  await startAsyncOperation.invokeStartAsyncOperationLambda(asyncOperationEvent);
  return res.send({ message: `Indexing database to ${indexName}. Operation id: ${asyncOperationId}` });
}

async function getCurrentIndex(req, res) {
  const esClient = await getEsClient();
  const alias = req.params.alias || defaultIndexAlias;

  const aliasIndices = await esClient.client.indices.getAlias({ name: alias })
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

module.exports = {
  indexFromDatabase,
  router,
};
