'use strict';

const test = require('ava');

const {
  extractCumulusConfigFromSF,
  fixCumulusMessageSyntax,
  generateWorkflowTemplate,
  generateTemplates
} = require('../lib/message');
const exampleConfig = require('./fixtures/config.json');
const exampleOutputs = require('./fixtures/outputs.json');

const noop = () => {}; // eslint-disable-line lodash/prefer-noop

test('test cumulus message syntax fix', (t) => {
  const fix = fixCumulusMessageSyntax;
  const testObj = {
    someKey: 'myKey{meta.stack}end',
    stack: '{$.meta.stack}',
    collections: '[$.meta.collections]',
    obj: {
      key1: 'key1',
      key2: 'key2'
    }
  };
  const returnObj = fix(Object.assign({}, testObj));
  t.is(`{${testObj.stack}}`, returnObj.stack);
  t.is(`{${testObj.collections}}`, returnObj.collections);
  t.is(testObj.someKey, returnObj.someKey);
  t.is(testObj.obj.key1, returnObj.obj.key1);
});

test('handing CumulusConfig in workflows', (t) => {
  const getConfig = extractCumulusConfigFromSF;
  const testObj = {
    stepFunctions: {
      DiscoverPdrs: {
        States: {
          MyTask1: {
            CumulusConfig: {
              collection: '{$.meta.collection}'
            }
          },
          MyTask2: {}
        }
      },
      ParsePdr: {
        States: {
          Mytask1: {}
        }
      }
    }
  };

  const returnObj = getConfig(JSON.parse(JSON.stringify(testObj)));

  // make sure there is workflowConfig key
  t.truthy(returnObj.workflowConfigs);

  // make sure CumulusConfig is removed from all states
  Object.keys(returnObj.stepFunctions).forEach((name) => {
    const sf = returnObj.stepFunctions[name];
    Object.keys(sf.States).forEach((state) => t.falsy(sf.States[state].CumulusConfig));

    // make sure there is a workflowConfig for each SF and its tasks
    t.truthy(returnObj.workflowConfigs[name]);
    Object.keys(sf.States).forEach((state) => t.truthy(returnObj.workflowConfigs[name][state]));
  });

  // test the value one of the workflowConfigs
  t.is(
    `{${testObj.stepFunctions.DiscoverPdrs.States.MyTask1.CumulusConfig.collection}}`,
    returnObj.workflowConfigs.DiscoverPdrs.MyTask1.collection
  );
});

test('generate a workflow template', (t) => {
  const tt = generateWorkflowTemplate(
    'DiscoverPdrs',
    exampleConfig.stepFunctions.DiscoverPdrs,
    exampleConfig,
    exampleOutputs
  );

  t.is(tt.cumulus_meta.message_source, 'sfn');
  t.is(tt.cumulus_meta.system_bucket, 'cumulus-devseed-internal');
  t.is(tt.meta.workflow_name, 'DiscoverPdrs');
  t.is(tt.meta.cmr.password, 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  t.is(
    tt.meta.templates.DiscoverPdrs,
    's3://cumulus-devseed-internal/lpdaac-cumulus/workflows/DiscoverPdrs.json'
  );
  t.truthy(tt.meta.queues.startSF);
  t.truthy(tt.workflow_config.DiscoverPdrs);
  t.truthy(tt.cumulus_meta.priorityLevels);
  t.is(tt.cumulus_meta.priorityLevels.low.maxExecutions, 5);
  t.is(tt.meta.priorityQueues.startSFLowPriority, 'low');
});

test('generate template for a step function', async (t) => {
  const promise = generateTemplates(exampleConfig, [], noop);
  await t.notThrows(promise);
});
