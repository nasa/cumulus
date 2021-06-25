const { listGranules, removePublishedGranule, deleteGranule } = require('@cumulus/api-client/granules');
const { getPdrs, deletePdr } = require('@cumulus/api-client/pdrs');
const { deleteExecution, getExecutions } = require('@cumulus/api-client/executions');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { constructCollectionId } = require('@cumulus/message/Collections');

const removeCollectionAndAllDependencies = async (params) => {
  const { config, collection } = params;
  const collectionGranuleResponse = await listGranules({
    prefix: config.stackName,
    query: {
      fields: ['granuleId', 'published'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });

  const granulesForDeletion = JSON.parse(collectionGranuleResponse.body).results;
  const granuleDeletionResult = await Promise.all(
    granulesForDeletion.map((granule) => {
      if (granule.published === true) {
        return removePublishedGranule({
          prefix: config.stackName,
          granuleId: granule.granuleId,
        });
      }
      return deleteGranule({
        prefix: config.stackName,
        granuleId: granule.granuleId,
      });
    })
  );

  console.log('Granule Cleanup Complete:');
  console.log(granulesForDeletion);
  console.log(granuleDeletionResult);

  const pdrResponse = await getPdrs({
    prefix: config.stackName,
    query: {
      fields: ['pdrName'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });

  const pdrsForDeletion = JSON.parse(pdrResponse.body).results;
  const pdrsDeletionResult = await Promise.all(
    pdrsForDeletion.map((pdr) =>
      deletePdr({ prefix: config.stackName, pdrName: pdr.pdrName }))
  );
  console.log('Pdr Cleanup Complete:');
  console.log(pdrsForDeletion);
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
  console.log(executionsForDeletion);
  console.log(executionDeletionResult);

  await deleteCollection({ prefix: config.stackName, collectionName: collection.name, collectionVersion: collection.version });
};

module.exports = { removeCollectionAndAllDependencies };
