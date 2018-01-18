'use strict';

import test from 'ava';
//import { handler } from '../index';

const localHelpers = require('@cumulus/common/local-helpers');
const testHelpers = require('@cumulus/common/test-helpers');
const _ = require('lodash');

const DiscoverCmrGranules = require('../index');

const localTaskName = 'DiscoverCmrGranules';
const message = localHelpers.collectionMessageInput('MOPITT_DCOSMR_LL_D_STD', localTaskName)();

test('check with valid parameters', async (t) => {
  const [error] = await testHelpers.run(DiscoverCmrGranules, message);
  t.is(error, null);
});

test('check with invalid query parameters', async (t) => {
  // Remove query parameter for  DiscoverCmrGranules Task
  const newPayload = _.cloneDeep(message); //Object assign will not work here
  delete newPayload.workflow_config_template.DiscoverCmrGranules.query;

  const [errors] = await testHelpers.run(DiscoverCmrGranules, newPayload);
  t.is(errors, 'Undefined query parameter');
});

test('check with invalid root parameter', async (t) => {
  // Remove root parameter for  DiscoverCmrGranules Task
  const newPayload = _.cloneDeep(message); //Object assign will not work here
  delete newPayload.workflow_config_template.DiscoverCmrGranules.root;

  const [errors] = await testHelpers.run(DiscoverCmrGranules, newPayload);
  t.is(errors, 'Undefined root parameter');
});

test('check with invalid event parameter', async (t) => {
  // Remove event parameter for  DiscoverCmrGranules Task
  const newPayload = _.cloneDeep(message); //Object assign will not work here
  delete newPayload.workflow_config_template.DiscoverCmrGranules.event;

  const [errors] = await testHelpers.run(DiscoverCmrGranules, newPayload);
  t.is(errors, 'Undefined event parameter');
});

test('check with invalid granule_meta parameter', async (t) => {
  // Remove granule_meta parameter for  DiscoverCmrGranules Task
  const newPayload = _.cloneDeep(message); //Object assign will not work here
  delete newPayload.workflow_config_template.DiscoverCmrGranules.granule_meta;

  const [errors] = await testHelpers.run(DiscoverCmrGranules, newPayload);
  t.is(errors, 'Undefined granule_meta parameter');
});
