'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const collectionsEndpoint = require('../../endpoints/collections');
const {
  fakeCollectionFactory,
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const { indexCollection } = require('../../es/indexer');
const { Search } = require('../../es/search');
const assertions = require('../../lib/assertions');

process.env.CollectionsTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();

const testCollection = fakeCollectionFactory();
const esIndex = randomString();
let esClient;

let authHeaders;
let collectionModel;
let userModel;
test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  collectionModel = new models.Collection({ tableName: process.env.CollectionsTable });
  await collectionModel.createTable();
  await collectionModel.create(testCollection);

  // create fake Users table
  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');
});

test.after.always(async () => {
  await collectionModel.deleteTable();
  await userModel.deleteTable();
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'POST',
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-912 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 POST with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-912 DELETE with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: 'asdf',
      version: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(collectionsEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('default returns list of collections', async (t) => {
  const newCollection = fakeCollectionFactory();

  const listEvent = {
    httpMethod: 'list',
    headers: authHeaders
  };

  await indexCollection(esClient, newCollection, esIndex);

  return testEndpoint(collectionsEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    t.is(results.length, 1);
    const responseBody = JSON.parse(response.body);
    t.is(responseBody.results[0].name, newCollection.name);
  });
});

test('GET returns an existing collection', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    headers: authHeaders,
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version
    }
  };
  return testEndpoint(collectionsEndpoint, getEvent, (response) => {
    const { name } = JSON.parse(response.body);
    t.is(name, testCollection.name);
  });
});

test('POST creates a new collection', (t) => {
  const newCollection = fakeCollectionFactory();
  const postEvent = {
    httpMethod: 'POST',
    headers: authHeaders,
    body: JSON.stringify(newCollection)
  };
  return testEndpoint(collectionsEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.name, newCollection.name);
  });
});

test('PUT updates an existing collection', (t) => {
  const newPath = '/new_path';
  const updateEvent = {
    body: JSON.stringify({
      name: testCollection.name,
      version: testCollection.version,
      provider_path: newPath
    }),
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version
    },
    httpMethod: 'PUT',
    headers: authHeaders
  };

  return testEndpoint(collectionsEndpoint, updateEvent, (response) => {
    const { provider_path } = JSON.parse(response.body); // eslint-disable-line camelcase
    t.is(provider_path, newPath);
  });
});

test('DELETE deletes an existing collection', (t) => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: testCollection.name,
      version: testCollection.version
    },
    headers: authHeaders
  };
  return testEndpoint(collectionsEndpoint, deleteEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
  });
});

test.todo('POST without name and version returns error message');
test.todo('PUT with invalid name and version returns error message');
// Multiple tests
test.todo('Test methods return not found');
