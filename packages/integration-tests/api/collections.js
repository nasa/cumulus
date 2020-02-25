'use strict';

const { callCumulusApi } = require('./api');

const createCollection = (prefix, collection) =>
  callCumulusApi({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: { 'Content-Type': 'application/json' },
      path: '/collections',
      body: JSON.stringify(collection)
    }
  });

const deleteCollection = (prefix, collectionName, collectionVersion) =>
  callCumulusApi({
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/collections/${collectionName}/${collectionVersion}`
    }
  });

const getCollection = (prefix, collectionName, collectionVersion) =>
  callCumulusApi({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/collections/${collectionName}/${collectionVersion}`
    }
  }).then(({ body }) => JSON.parse(body));

module.exports = {
  createCollection,
  deleteCollection,
  getCollection
};
