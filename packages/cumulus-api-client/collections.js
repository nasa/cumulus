'use strict';

const { invokeApi } = require('./cumulusApiClient');

const createCollection = async ({ prefix, collection, callback = invokeApi }) => callback({
  prefix,
  payload: {
    httpMethod: 'POST',
    resource: '/{proxy+}',
    headers: { 'Content-Type': 'application/json' },
    path: '/collections',
    body: JSON.stringify(collection)
  }
});

const deleteCollection = async ({
  prefix, collectionName, collectionVersion, callback = invokeApi
}) => callback({
  prefix,
  payload: {
    httpMethod: 'DELETE',
    resource: '/{proxy+}',
    path: `/collections/${collectionName}/${collectionVersion}`
  }
});

const getCollection = async ({
  prefix, collectionName, collectionVersion, callback = invokeApi
}) => {
  const returnedCollection = await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/collections/${collectionName}/${collectionVersion}`
    }
  });
  return JSON.parse(returnedCollection.body);
};

module.exports = {
  createCollection,
  deleteCollection,
  getCollection
};
