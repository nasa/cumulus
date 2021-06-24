const { listGranules, removePublishedGranule } = require('@cumulus/api-client/granules');
const { getPdrs, deletePdr } = require('@cumulus/api-client/pdrs');
const { deleteExecution, getExecutions } = require('@cumulus/api-client/executions');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { constructCollectionId } = require('@cumulus/message/Collections');

const removeCollectionAndAllDependencies = async (params) => {
  const { config, collection } = params;
  const collectionGranuleResponse = await listGranules({
    prefix: config.stackName,
    query: {
      fields: ['granuleId'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });

  if (collectionGranuleResponse.statusCode !== 200) {
    throw new Error('Invalid listGranules response');
  }
  const granulesForDeletion = JSON.parse(collectionGranuleResponse.body).results;
  const granuleDeletionResult = await Promise.all(
    granulesForDeletion.map((granule) =>
      removePublishedGranule({
        prefix: config.stackName,
        granuleId: granule.granuleId,
      }))
  );

  console.log('Granule Cleanup Complete:');
  console.log(granuleDeletionResult);

  const pdrResponse = await getPdrs({
    prefix: config.stackName,
    query: {
      fields: ['pdrName'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });

  if (pdrResponse.statusCode !== 200) {
    throw new Error('Invalid listGranules response');
  }

  const pdrsForDeletion = JSON.parse(pdrResponse.body).results;
  const pdrsDeletionResult = await Promise.all(
    pdrsForDeletion.map((pdr) =>
      deletePdr({ prefix: config.stackName, pdrName: pdr.pdrName }))
  );
  console.log('Pdr Cleanup Complete:');
  console.log(pdrsDeletionResult);

  const executionsResponse = await getExecutions({
    prefix: config.stackName,
    query: {
      fields: ['arn'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });
  const executionsForDeletion = JSON.parse(executionsResponse.body).results;

  const executionDeletionResult = await Promise.all(
    executionsForDeletion.map((execution) =>
      deleteExecution({ prefix: config.stackName, executionArn: execution.arn }))
  );
  console.log('Execution Cleanup Complete:');
  console.log(executionDeletionResult);

  const deleteCollectionResult = await deleteCollection({ prefix: config.stackName, collectionName: collection.name, collectionVersion: collection.version });
  if (deleteCollectionResult.statusCode !== 200) {
    throw new Error('Invalid deleteCollection response');
  }
};

module.exports = { removeCollectionAndAllDependencies };
