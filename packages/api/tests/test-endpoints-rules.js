'use strict';

const test = require('ava');

process.env.RulesTable = 'Test_RulesTable';
process.env.stackName = 'test-stack';
process.env.bucket = 'test-bucket';
const workflowName = 'morning-routine';
const workflowfile = `${process.env.stackName}/workflows/${workflowName}.json`;

const aws = require('@cumulus/common/aws');
const bootstrap = require('../lambdas/bootstrap');
const models = require('../models');
const rulesEndpoint = require('../endpoints/rules');
const { testEndpoint } = require('./testUtils');

const rules = new models.Rule();

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

const hash = { name: 'name', type: 'S' };
async function setup() {
  await bootstrap.bootstrapElasticSearch('http://localhost:4571');
  await aws.s3().createBucket({ Bucket: process.env.bucket }).promise();
  await aws.s3().putObject({
    Bucket: process.env.bucket,
    Key: workflowfile,
    Body: 'test data'
  }).promise();
  await models.Manager.createTable(process.env.RulesTable, hash);
  await rules.create(testRule);
}

async function teardown() {
  models.Manager.deleteTable(process.env.RulesTable);
  await aws.recursivelyDeleteS3Bucket(process.env.bucket);
}

test.before(async () => setup());
test.after.always(async () => teardown());

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
  const newRule = Object.assign({}, testRule, {name: 'make_waffles'});
  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newRule)
  };
  return testEndpoint(rulesEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.name, newRule.name);
  });
});

test('PUT updates a rule', (t) => {
  const updateEvent = {
    body: JSON.stringify({state: 'ENABLED'}),
    pathParameters: {
      name: testRule.name
    },
    httpMethod: 'PUT'
  };
  return testEndpoint(rulesEndpoint, updateEvent, (response) => {
    const { state } = JSON.parse(response.body);
    t.is(state, 'ENABLED');
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

test.todo('POST returns a record exists when one exists');

