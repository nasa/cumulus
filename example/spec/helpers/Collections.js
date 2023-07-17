'use strict';

const pRetry = require('p-retry');

const { listGranules } = require('@cumulus/api-client/granules');
const { getPdrs, deletePdr } = require('@cumulus/api-client/pdrs');
const { deleteExecution, getExecutions } = require('@cumulus/api-client/executions');
const { deleteCollection, getCollection } = require('@cumulus/api-client/collections');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { deleteGranules } = require('./granuleUtils');

/**
 * COPIED from integration-tests package. Returns true if collection exists. False otherwise.
 *
 * @param {string} stackName - the prefix of the Cumulus stack
 * @param {Object} collection - a Cumulus collection
 * @returns {boolean}
 */
const collectionExists = async (stackName, collection) => {
  let response;
  const exists = await pRetry(
    async () => {
      try {
        response = await getCollection({
          prefix: stackName,
          collectionName: collection.name,
          collectionVersion: collection.version,
          pRetryOptions: {
            retries: 0,
          },
        });
      } catch (error) {
        if (error.statusCode === 404) {
          console.log(`Error: ${error}. Failed to get collection ${JSON.stringify(collection)}`);
          return false;
        }
        throw error;
      }
      if (response.statusCode === 200) {
        return true;
      }
      return false;
    },
    { retries: 5, minTimeout: 2000, maxTimeout: 2000 }
  );
  console.log('Collection exists:', exists);
  return exists;
};

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
  let granuleDeletionResult;
  const { prefix, collection } = params;
  const collectionGranuleResponse = await listGranules({
    prefix,
    query: {
      fields: ['granuleId', 'published'],
      collectionId: constructCollectionId(collection.name, collection.version),
    },
  });

  const granulesForDeletion = JSON.parse(collectionGranuleResponse.body).results;
  try {
    granuleDeletionResult = await deleteGranules(prefix, granulesForDeletion);
  } catch (error) {
    if (error.statusCode === 404) {
      console.log('No granule to delete');
    }
  }

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
  try {
    await collectionExists(prefix, collection);
    await deleteCollection({ prefix, collectionName: collection.name, collectionVersion: collection.version });
  } catch (error) {
    console.log(`Error: ${error}. Failed delete collection ${JSON.stringify(collection)}`);
  }
};

/**
 * Returns collectionId with version encoded.
 *
 * @param {string} name - collection name
 * @param {string} version - collection version
 * @returns {string}
 */
const encodedConstructCollectionId = (name, version) => {
  const encodedVersion = encodeURIComponent(version);

  return constructCollectionId(name, encodedVersion);
};

module.exports = { removeCollectionAndAllDependencies, encodedConstructCollectionId };
