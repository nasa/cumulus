'use strict';

const test = require('ava');
const request = require('supertest');
const { randomString } = require('@cumulus/common/test-utils');

const models = require('../../models');
const assertions = require('../../lib/assertions');

process.env.AccessTokensTable = randomString();
process.env.UsersTable = randomString();

// import the express app after setting the env variables
const { app } = require('../../app');

let userModel;
test.before(async () => {
  userModel = new models.User();
  await userModel.createTable();
});

test.after.always(() => userModel.deleteTable());

test('with pathParameters and everything good', async (t) => {
  
});



