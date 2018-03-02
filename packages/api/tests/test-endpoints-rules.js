'use strict';

const test = require('ava');

process.env.RulesTable = 'Test_RulesTable';
process.env.stackName = 'test-stack';
process.env.bucket = 'test-bucket';
const workflowName = 'morning-routine';
const workflowfile = `${process.env.stackName}/workflows/${workflowName}.json`;

const models = require('../models');
const aws = require('@cumulus/common/aws');
const rulesEndpoint = require('../endpoints/rules');
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
  await aws.s3().createBucket({ Bucket: process.env.bucket }).promise();
  await models.Manager.createTable(process.env.RulesTable, hash);
  await aws.s3().putObject({
    Bucket: process.env.bucket,
    Key: workflowfile,
    Body: 'test data'
  }).promise();
}

async function teardown() {
  models.Manager.deleteTable(process.env.RulesTable);
  await aws.recursivelyDeleteS3Bucket(process.env.bucket);
}

test.before(async () => setup());
test.after.always(async () => teardown());

test('default returns list of rules', t => {
  return rules.create(testRule)
    .then(rule => rules.get({name: testRule.name}))
    .then(r => {
      return new Promise((resolve, reject) => {
        rulesEndpoint(
          {
            httpMethod: 'list'
          },
          {
            succeed: (r) => resolve(t.is(JSON.parse(r.body).Items.length, 1)),
            fail: (e) => reject(e)
          }
        )     
      });
    });
});
