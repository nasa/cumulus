'use strict';

const router = require('express-promise-router')();

const log = require('@cumulus/common/log');
const asyncOperations = require('@cumulus/async-operations');

const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const { IndexExistsError } = require('../lib/errors');
const { defaultIndexAlias, Search } = require('../es/search');
const { createIndex } = require('../es/indexer');
const models = require('../models');

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

async function reindex(req, res) {
  let sourceIndex = req.body.sourceIndex;
  let destIndex = req.body.destIndex;
  const aliasName = req.body.aliasName || defaultIndexAlias;

  const esClient = await Search.es();

  if (!sourceIndex) {
    const alias = await esClient.indices.getAlias({
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
    const sourceExists = await esClient.indices.exists({ index: sourceIndex })
      .then((response) => response.body);

    if (!sourceExists) {
      return res.boom.badRequest(`Source index ${sourceIndex} does not exist.`);
    }
  }

  if (!destIndex) {
    destIndex = timestampedIndexName();
  }

  const destExists = await esClient.indices.exists({ index: destIndex })
    .then((response) => response.body);

  if (!destExists) {
    try {
      await createIndex(esClient, destIndex);
      log.info(`Created destination index ${destIndex}.`);
    } catch (error) {
      return res.boom.badRequest(`Error creating index ${destIndex}: ${error.message}`);
    }
  }

  // reindex
  esClient.reindex({
    body: {
      source: { index: sourceIndex },
      dest: { index: destIndex },
    },
  });

  const message = `Reindexing to ${destIndex} from ${sourceIndex}. Check the reindex-status endpoint for status.`;

  return res.status(200).send({ message });
}

async function reindexStatus(req, res) {
  const esClient = await Search.es();

  const reindexTaskStatus = await esClient.tasks.list({ actions: ['*reindex'] })
    .then((response) => response.body);

  await esClient.indices.refresh();

  const indexStatus = await esClient.indices.stats({
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
    try {
      await createIndex(esClient, newIndex);
      log.info(`Created destination index ${newIndex}.`);
    } catch (error) {
      return res.boom.badRequest(`Error creating index ${newIndex}: ${error.message}`);
    }
  }

  try {
    await esClient.indices.updateAliases({
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
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const tableName = process.env.AsyncOperationsTable;
  const knexConfig = process.env;

  await createIndex(esClient, indexName)
    .catch((error) => {
      if (!(error instanceof IndexExistsError)) throw error;
    });

  const asyncOperation = await asyncOperations.startAsyncOperation({
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
        asyncOperationsTable: process.env.AsyncOperationsTable,
      },
      esHost: process.env.ES_HOST,
      esRequestConcurrency: process.env.ES_CONCURRENCY,
      stackName,
      systemBucket,
      dynamoTableName: tableName,
      knexConfig,
    },
  }, models.AsyncOperation);

  return res.send({ message: `Indexing database to ${indexName}. Operation id: ${asyncOperation.id}` });
}

async function getCurrentIndex(req, res) {
  const esClient = await Search.es();
  const alias = req.params.alias || defaultIndexAlias;

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
