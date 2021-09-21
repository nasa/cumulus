const { listGranules } = require('@cumulus/api-client/granules');
const { getPdrs, deletePdr } = require('@cumulus/api-client/pdrs');
const { deleteExecution, getExecutions } = require('@cumulus/api-client/executions');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { deleteGranules } = require('./granuleUtils');

/**
* Helper to remove a collection and all its dependencies
* @summary Uses api-client to search for collection dependencies, remove them all and then remove the collection
*          Cleans up:
*            - published/unpublished Granules
*            - PDRs
*            - Executions
*            - the specified Collection
* @param {Object} params     - params
* @param {string} params.prefix  - Config object containing stackName
* @param {Object} params.collection - Cumulus API collection object to delete
* @returns {Promise<undefined>}
*/
const removeCollectionAndAllDependencies = async (params) => {
  const { prefix, collection } = params;
  const collectionGranuleResponse = await listGranules({
    prefix,
    query: {
      fields: ['granuleId', 'published'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });

  const granulesForDeletion = JSON.parse(collectionGranuleResponse.body).results;
  const granuleDeletionResult = deleteGranules(prefix, granulesForDeletion);

  console.log('Granule Cleanup Complete:');
  console.log(granulesForDeletion);
  console.log(granuleDeletionResult);

  const pdrResponse = await getPdrs({
    prefix,
    query: {
      fields: ['pdrName'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });

  const pdrsForDeletion = JSON.parse(pdrResponse.body).results;
  const pdrsDeletionResult = await Promise.all(
    pdrsForDeletion.map((pdr) =>
      deletePdr({ prefix, pdrName: pdr.pdrName }))
  );
  console.log('Pdr Cleanup Complete:');
  console.log(pdrsForDeletion);
  console.log(pdrsDeletionResult);

  const executionsResponse = await getExecutions({
    prefix,
    query: {
      fields: ['arn'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });
  const executionsForDeletion = JSON.parse(executionsResponse.body).results;

  const executionDeletionResult = await Promise.all(
    executionsForDeletion.map((execution) =>
      deleteExecution({ prefix, executionArn: execution.arn }))
  );
  console.log('Execution Cleanup Complete:');
  console.log(executionsForDeletion);
  console.log(executionDeletionResult);

  await deleteCollection({ prefix, collectionName: collection.name, collectionVersion: collection.version });
};

module.exports = { removeCollectionAndAllDependencies };
