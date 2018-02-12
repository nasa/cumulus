
const test = require('ava');
const kes = require('../app/kes.override');

test('test cumulus message syntax fix', (t) => {
  const fix = kes.fixCumulusMessageSyntax;
  const testObj = {
    useQueue: true,
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
  t.is(testObj.useQueue, returnObj.useQueue);
  t.is(testObj.someKey, returnObj.someKey);
  t.is(testObj.obj.key1, returnObj.obj.key1);
});

test('handing CumulusConfig in workflows', (t) => {
  const getConfig = kes.extractCumulusConfigFromSF;
  const testObj = {
    stepFunctions: {
      DiscoverPdrs: {
        States: {
          MyTask1: {
            CumulusConfig: {
              useQueue: true,
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
