'use strict';

import test from 'ava';

const localHelpers = require('@cumulus/common/local-helpers');
const testHelpers = require('@cumulus/common/test-helpers');
const path = require('path');

const CopyIdxTask = require('../index');

const localTaskName = 'CopyIdxFromS3';
const configFile = path.join(__dirname, './ast_l1t.yml')
const payload = require('@cumulus/test-data/payloads/payload_ast_l1t_ll.json');


test('check with invalid parameters', async (t) => {
  function Payload(p) { return p };
  const message = localHelpers.collectionMessageInput('AST_L1T_DAY', localTaskName, Payload, configFile)();
  delete message.workflow_config_template.CopyIdxFromS3.dirname
  //console.log("Message:", JSON.stringify(message, null, '\t'));

  const [error] = await testHelpers.run(CopyIdxTask, message);
  t.is(error, 'Undefined directory name');
});


test('check with valid dirname and payload', async (t) => {
 
  function Payload(p) { return payload; }
  const message = localHelpers.collectionMessageInput('AST_L1T_DAY', localTaskName, Payload, configFile)();

  const [error] = await testHelpers.run(CopyIdxTask, message);
  t.is(error, null);
});
