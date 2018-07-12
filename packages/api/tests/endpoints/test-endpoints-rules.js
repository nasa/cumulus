'use strict';

const test = require('ava');
const cloneDeep = require('lodash.clonedeep');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const bootstrap = require('../../lambdas/bootstrap');
const models = require('../../models');
const rulesEndpoint = require('../../endpoints/rules');
const { testEndpoint } = require('../../lib/testUtils');
const { Search } = require('../../es/search');

const esIndex = randomString();

process.env.RulesTable = randomString();
process.env.stackName = randomString();
process.env.bucket = randomString();
const workflowName = randomString();
const workflowfile = `${process.env.stackName}/workflows/${workflowName}.json`;

const testRule = {
  name: 'make_coffee',
  workflow: workflowName,
  provider: 'whole-foods',
  collection: {
    name: 'compass',
    version: '0.0.0'
  },
  rule: {
    type: 'onetime'
  },
  state: 'DISABLED'
};

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  await aws.s3().createBucket({ Bucket: process.env.bucket }).promise();
  await aws.s3().putObject({
    Bucket: process.env.bucket,
    Key: workflowfile,
    Body: 'test data'
  }).promise();

  await models.Manager.createTable(
    process.env.RulesTable,
    { name: 'name', type: 'S' }
  );

  await (new models.Rule()).create(testRule);
});

test.after.always(async () => {
  models.Manager.deleteTable(process.env.RulesTable);
  await aws.recursivelyDeleteS3Bucket(process.env.bucket);

  const esClient = await Search.es('fakehost');
  await esClient.indices.delete({ index: esIndex });
});

// TODO(aimee): Add a rule to ES. List uses ES and we don't have any rules in ES.
test('default returns list of rules', (t) => {
  const listEvent = { httpMethod: 'list ' };
  return testEndpoint(rulesEndpoint, listEvent, (response) => {
    const { results } = JSON.parse(response.body);
    t.is(results.length, 0);
  });
});

test('GET gets a rule', (t) => {
  const getEvent = {
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'GET'
  };
  return testEndpoint(rulesEndpoint, getEvent, (response) => {
    const { name } = JSON.parse(response.body);
    t.is(name, testRule.name);
  });
});

test('POST creates a rule', (t) => {
  const newRule = Object.assign(cloneDeep(testRule), { name: 'make_waffles' });
  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newRule)
  };

  return testEndpoint(rulesEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');

    newRule.createdAt = record.createdAt;
    newRule.updatedAt = record.updatedAt;

    t.deepEqual(record, newRule);
  });
});

test('POST returns a record exists when one exists', (t) => {
  const newRule = Object.assign({}, testRule);
  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newRule)
  };
  return testEndpoint(rulesEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, `A record already exists for ${newRule.name}`);
    t.falsy(record);
  });
});

test('PUT updates a rule', (t) => {
  const newRule = Object.assign({}, testRule, { state: 'ENABLED' });

  const updateEvent = {
    body: JSON.stringify({ state: 'ENABLED' }),
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'PUT'
  };
  return testEndpoint(rulesEndpoint, updateEvent, (response) => {
    const record = JSON.parse(response.body);
    newRule.createdAt = record.createdAt;
    newRule.updatedAt = record.updatedAt;

    t.deepEqual(record, newRule);
  });
});

test('PUT returns "only state and rule.value values can be changed"', (t) => {
  const updateEvent = {
    body: JSON.stringify({ provider: 'new-whole-foods' }),
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'PUT'
  };
  return testEndpoint(rulesEndpoint, updateEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Only state and rule.value values can be changed');
    t.falsy(record);
  });
});

test('PUT returns "record does not exist"', (t) => {
  const updateEvent = {
    body: JSON.stringify({ state: 'ENABLED' }),
    pathParameters: {
      name: 'new_make_coffee'
    },
    httpMethod: 'PUT'
  };
  return testEndpoint(rulesEndpoint, updateEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record does not exist');
    t.falsy(record);
  });
});

test('DELETE deletes a rule', (t) => {
  const deleteEvent = {
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'DELETE'
  };
  return testEndpoint(rulesEndpoint, deleteEvent, (response) => {
    const { message } = JSON.parse(response.body);
    t.is(message, 'Record deleted');
  });
});

