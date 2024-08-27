'use strict';

const { getEsClient } = require('@cumulus/es-client/search');

const localStackName = 'localrun';
const localSystemBucket = 'localbucket';
const localUserName = 'testUser';

const setLocalEsVariables = (stackName) => {
  process.env.ES_HOST = 'fakehost';
  process.env.ES_INDEX = `${stackName}-es`;
};

/**
 *  Retrieves Elasticsearch's Client and Index.
 * @param {string} stackName - local stack name
 * @returns {Promise<Object>} - Elasticsearch test client and index.
 */
const getESClientAndIndex = async (stackName = localStackName) => {
  setLocalEsVariables(stackName);
  const client = await getEsClient(process.env.ES_HOST);
  const index = process.env.ES_INDEX;
  return { client, index };
};

module.exports = {
  getESClientAndIndex,
  setLocalEsVariables,
  localStackName,
  localSystemBucket,
  localUserName,
};
