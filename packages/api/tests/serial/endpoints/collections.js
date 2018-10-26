'use strict';

const test = require('ava');
const sinon = require('sinon');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const collectionsEndpoint = require('../../../endpoints/collections');
const {
  fakeCollectionFactory,
  fakeUserFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const EsCollection = require('../../../es/collections');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const { RecordDoesNotExist } = require('../../../lib/errors');

process.env.CollectionsTable = randomString();
process.env.UsersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();

const esIndex = randomString();
let esClient;

let authHeaders;
let collectionModel;
let userModel;

const collectionDoesNotExist = async (t, collection) => {
  const error = await t.throws(collectionModel.get({
    name: collection.name,
    version: collection.version
  }));
  t.true(error instanceof RecordDoesNotExist);
};

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);
  await aws.s3().createBucket({ Bucket: process.env.internal }).promise();

  collectionModel = new models.Collection({ tableName: process.env.CollectionsTable });
  await collectionModel.createTable();

  // create fake Users table
  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testCollection = fakeCollectionFactory();
  await collectionModel.create(t.context.testCollection);
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

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', (t) => {
  const newCollection = fakeCollectionFactory();
  const request = {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(newCollection)
  };

  return testEndpoint(collectionsEndpoint, request, async (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
    await collectionDoesNotExist(t, newCollection);
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
  const newCollection = fakeCollectionFactory();
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    },
    body: JSON.stringify(newCollection)
  };

  return testEndpoint(collectionsEndpoint, request, async (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
    await collectionDoesNotExist(t, newCollection);
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

test('POST with invalid authorization scheme returns an invalid token response', (t) => {
  const newCollection = fakeCollectionFactory();
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'InvalidBearerScheme ThisIsAnInvalidAuthorizationToken'
    },
    body: JSON.stringify(newCollection)
  };

  return testEndpoint(collectionsEndpoint, request, async (response) => {
    assertions.isInvalidAuthorizationResponse(t, response);
    await collectionDoesNotExist(t, newCollection);
  });
});

test.serial('default returns list of collections', async (t) => {
  const listEvent = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  const stub = sinon.stub(EsCollection.prototype, 'getStats').returns([t.context.testCollection]);

  return testEndpoint(collectionsEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    stub.restore();
    t.is(results.length, 1);
    t.is(results[0].name, t.context.testCollection.name);
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

test.serial('GET returns an existing collection', (t) => {
  const getEvent = {
    httpMethod: 'GET',
    headers: authHeaders,
    pathParameters: {
      collectionName: t.context.testCollection.name,
      version: t.context.testCollection.version
    }
  };
  const stub = sinon.stub(EsCollection.prototype, 'getStats').returns([t.context.testCollection]);
  return testEndpoint(collectionsEndpoint, getEvent, (response) => {
    const { name } = JSON.parse(response.body);
    stub.restore();
    t.is(name, t.context.testCollection.name);
  });
});

test('PUT updates an existing collection', (t) => {
  const newPath = '/new_path';
  const updateEvent = {
    body: JSON.stringify({
      name: t.context.testCollection.name,
      version: t.context.testCollection.version,
      provider_path: newPath
    }),
    pathParameters: {
      collectionName: t.context.testCollection.name,
      version: t.context.testCollection.version
    },
    httpMethod: 'PUT',
    headers: authHeaders
  };

  return testEndpoint(collectionsEndpoint, updateEvent, (response) => {
    const { provider_path } = JSON.parse(response.body); // eslint-disable-line camelcase
    t.is(provider_path, newPath);
  });
});

test.serial('PUT updates an existing collection and returns it in listing', (t) => {
  const newPath = `/${randomString()}`;
  const updateParams = { provider_path: newPath };
  const updatedCollection = Object.assign(t.context.testCollection, updateParams);
  const updateEvent = {
    body: JSON.stringify(updateParams),
    pathParameters: {
      collectionName: t.context.testCollection.name,
      version: t.context.testCollection.version
    },
    httpMethod: 'PUT',
    headers: authHeaders
  };

  t.plan(2);
  return testEndpoint(collectionsEndpoint, updateEvent, () => {
    const listEvent = {
      httpMethod: 'GET',
      headers: authHeaders
    };

    const stub = sinon.stub(EsCollection.prototype, 'getStats').returns([updatedCollection]);
    return testEndpoint(collectionsEndpoint, listEvent, (response) => {
      const { results } = JSON.parse(response.body);
      stub.restore();
      t.is(results.length, 1);
      t.deepEqual(results[0], updatedCollection);
    });
  });
});

test('PUT without an Authorization header returns an Authorization Missing response and does not update an existing collection', (t) => {
  const newPath = `/${randomString()}`;
  const updateEvent = {
    body: JSON.stringify({
      name: t.context.testCollection.name,
      version: t.context.testCollection.version,
      provider_path: newPath
    }),
    pathParameters: {
      collectionName: t.context.testCollection.name,
      version: t.context.testCollection.version
    },
    httpMethod: 'PUT',
    headers: {}
  };

  return testEndpoint(collectionsEndpoint, updateEvent, async (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
    const collection = await collectionModel.get({
      name: t.context.testCollection.name,
      version: t.context.testCollection.version
    });
    t.is(collection.provider_path, t.context.testCollection.provider_path);
  });
});

test('DELETE deletes an existing collection', (t) => {
  const deleteEvent = {
    httpMethod: 'DELETE',
    pathParameters: {
      collectionName: t.context.testCollection.name,
      version: t.context.testCollection.version
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
