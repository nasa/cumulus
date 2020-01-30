'use strict';

const { Search } = require('../es/search');

const localStackName = 'localrun';
const localSystemBucket = 'localbucket';
const localUserName = 'testUser';

const setLocalEsVariables = (stackName) => {
  process.env.ES_HOST = 'fakehost';
  process.env.ES_INDEX = `${stackName}-es`;
};

/**
 *  Retrieves Elasticsearch's Client and Index.
 * @returns {Promise<Object>} -
 */
const getESClientAndIndex = async () => {
  const client = await Search.es(process.env.ES_HOST);
  const index = process.env.ES_INDEX;
  return { client, index };
};

module.exports = {
  getESClientAndIndex,
  setLocalEsVariables,
  localStackName,
  localSystemBucket,
  localUserName
};
