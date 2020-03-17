'use strict';

const { invokeApi } = require('./cumulusApiClient');

// TODO convert calls to async
const createCollection = async (prefix, collection, callback = invokeApi) =>
  callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/collections',
      body: JSON.stringify(collection)
    }
  });

// TODO convert calls to async
const deleteCollection = async (prefix, collectionName, collectionVersion, callback = invokeApi) =>
  callback({
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/collections/${collectionName}/${collectionVersion}`
    }
  });

// TODO convert calls to async
const getCollection = async (prefix, collectionName, collectionVersion, callback = invokeApi) => {
  return callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/collections/${collectionName}/${collectionVersion}`
    }
  }).then(({ body }) => JSON.parse(body));
};

module.exports = {
  createCollection,
  deleteCollection,
  getCollection
};
