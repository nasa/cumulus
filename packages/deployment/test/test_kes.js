/* eslint no-template-curly-in-string: "off" */

'use strict';

const sinon = require('sinon');
const test = require('ava');
const get = require('lodash.get');

const configFixture = require('./fixtures/config.json');
const aliasFixture = require('./fixtures/aliases.json');
const UpdatedKes = require('../lib/kes');

test.beforeEach((t) => {
  t.context.kes = new UpdatedKes(configFixture);
});

function setupKesForLookupLambdaReference(kes, functionName, hashValue) {
  kes.config.lambdas = { [functionName]: { hash: hashValue } };
  return kes;
}

test('lookupLambdaReference returns the expected alias resource string', (t) => {
  const resourceString = '${FunctionNameLambdaFunction.Arn}';
  const kes = setupKesForLookupLambdaReference(t.context.kes, 'FunctionName', 'notarealhash');
  const result = kes.lookupLambdaReference(resourceString);
  t.is(result, '${FunctionNameLambdaAliasOutput}');
});

test('lookupLambdaReference returns the original ', (t) => {
  const resourceString = '${FunctionNameLambdaFunction.Arn}';
  const kes = setupKesForLookupLambdaReference(t.context.kes, 'FunctionName', null);
  const result = kes.lookupLambdaReference(resourceString);
  t.is(result, resourceString);
});

test('lookupLambdaReference throws error on invalid configuration', (t) => {
  const resourceString = '${SomeOtherConfigurationString.foobar}';
  const kes = setupKesForLookupLambdaReference(t.context.kes, 'FunctionName', null);
  const error = t.throws(() => {
    kes.lookupLambdaReference(resourceString);
  }, Error);
  t.is(error.message, `Invalid stateObjectResource: ${resourceString}`);
});

test('injectWorkflowLambdaAliases updates the correct resources', (t) => {
  const kes = t.context.kes;

  kes.config.lambdas = {
    TestLambda: { hash: 'notarealhash' },
    TestUnversionedLambda: { hash: null }
  };

  kes.config.stepFunctions = {
    TestStepFunction: {
      States: {
        1: { Type: 'Task', Resource: '${TestLambdaLambdaFunction.Arn}' },
        2: { Type: 'Task', Resource: '${TestUnversionedLambdaLambdaFunction.Arn}' },
        3: { Type: 'Task', Resource: '${SomethingElse.Arn}' }
      }
    },
    TestStepFunction2: {
      States: {
        1: { Type: 'Task', Resource: '${TestLambdaLambdaFunction.Arn}' }
      }
    }
  };

  const expected = {
    TestStepFunction: {
      States: {
        1: { Type: 'Task', Resource: '${TestLambdaLambdaAliasOutput}' },
        2: { Type: 'Task', Resource: '${TestUnversionedLambdaLambdaFunction.Arn}' },
        3: { Type: 'Task', Resource: '${SomethingElse.Arn}' }
      }
    },
    TestStepFunction2: {
      States: {
        1: { Type: 'Task', Resource: '${TestLambdaLambdaAliasOutput}' }
      }
    }
  };

  kes.injectWorkflowLambdaAliases();
  t.deepEqual(expected, kes.config.stepFunctions);
});


test('injectOldWorkflowLambdaAliases adds oldLambdas to configuration object', async (t) => {
  const kes = t.context.kes;
  const nameArray = [
    {
      name: 'LambdaName-12345',
      humanReadableIdentifier: 'id12345'
    },
    {
      name: 'LambdaName-abcde',
      humanReadableIdentifier: 'idabcde'
    },
    {
      name: 'SecondLambdaName-67890',
      humanReadableIdentifier: 'id67890'
    }
  ];

  kes.getRetainedLambdaAliasMetadata = () => (Promise.resolve(nameArray));

  const expected = {
    LambdaName: {
      lambdaRefs:
      [
        {
          hash: '12345',
          humanReadableIdentifier: 'id12345'
        },
        {
          hash: 'abcde',
          humanReadableIdentifier: 'idabcde'
        }
      ]
    },
    SecondLambdaName:
    {
      lambdaRefs:
      [
        {
          hash: '67890',
          humanReadableIdentifier: 'id67890'
        }
      ]
    }
  };

  await kes.injectOldWorkflowLambdaAliases();
  t.deepEqual(expected, kes.config.oldLambdas);
});


test('parseAliasName parses the alias name', (t) => {
  const expected = { name: 'functionName', hash: 'hashValue' };
  const actual = t.context.kes.parseAliasName('functionName-hashValue');
  t.deepEqual(expected, actual);
});

test('parseAliasName returns null hash if hash missing', (t) => {
  const expected = { name: 'functionName', hash: null };
  const actual = t.context.kes.parseAliasName('functionName-');
  t.deepEqual(expected, actual);
});


test.serial('getAllLambdaAliases returns an unpaginated list of aliases', async (t) => {
  const kes = t.context.kes;

  // Mock out AWS calls
  const versionUpAliases = aliasFixture.aliases[0];

  const listAliasesStub = sinon.stub().callsFake(() => Promise.reject());

  sinon.stub(kes.AWS, 'Lambda').callsFake(() => (
    {
      listAliases: (_config) => (
        { promise: listAliasesStub }
      )
    }
  ));

  for (let i = 0; i < versionUpAliases.length - 1; i += 1) {
    listAliasesStub.onCall(i).returns(Promise.resolve({
      NextMarker: 'mocked out',
      Aliases: [versionUpAliases[i]]
    }));
  }
  listAliasesStub.onCall(versionUpAliases.length - 1).returns(
    Promise.resolve({ Aliases: [versionUpAliases[versionUpAliases.length - 1]] })
  );

  const lambda = kes.AWS.Lambda();
  const config = { MaxItems: 1, FunctionName: 'Mocked' };

  const actual = await kes.getAllLambdaAliases(lambda, config);

  t.deepEqual(versionUpAliases, actual,
    `Expected:${JSON.stringify(versionUpAliases)}\n\n`
    + `Actual:${JSON.stringify(actual)}`);
});

test.serial('getRetainedLambdaAliasMetadata returns filtered aliasNames', async (t) => {
  const kes = t.context.kes;

  kes.config.workflowLambdas = aliasFixture.workflowLambdas;
  kes.config.maxNumberOfRetainedLambdas = 2;
  const getAllLambdaAliasesStub = sinon.stub(kes, 'getAllLambdaAliases');
  for (let i = 0; i < aliasFixture.aliases.length; i += 1) {
    getAllLambdaAliasesStub.onCall(i).returns(aliasFixture.aliases[i]);
  }

  const expected = [
    {
      name: 'VersionUpTest-PreviousVersionHash',
      humanReadableIdentifier: 'humanReadableVersion13'
    },
    {
      name: 'VersionUpTest-SecondPreviousVersionHash',
      humanReadableIdentifier: 'humanReadableVersion12'
    },
    {
      name: 'HelloWorld-d49d272b8b1e8eb98a61affc34b1732c1032b1ca',
      humanReadableIdentifier: 'humanReadableVersion13'
    }
  ];

  const actual = await kes.getRetainedLambdaAliasMetadata();
  t.deepEqual(expected, actual);
});

test.serial('getRetainedLambdaAliasNames returns filtered aliasNames '
            + 'on previous version redeployment', async (t) => {
  const kes = t.context.kes;

  kes.config.workflowLambdas = aliasFixture.workflowLambdas;
  kes.config.workflowLambdas.VersionUpTest.hash = 'PreviousVersionHash';
  const getAllLambdaAliasesStub = sinon.stub(kes, 'getAllLambdaAliases');
  for (let i = 0; i < aliasFixture.aliases.length; i += 1) {
    getAllLambdaAliasesStub.onCall(i).returns(aliasFixture.aliases[i]);
  }

  const expected = [
    {
      name: 'VersionUpTest-LatestVersionHash',
      humanReadableIdentifier: 'humanReadableVersion14'
    },
    {
      name: 'VersionUpTest-SecondPreviousVersionHash',
      humanReadableIdentifier: 'humanReadableVersion12'
    },
    {
      name: 'HelloWorld-d49d272b8b1e8eb98a61affc34b1732c1032b1ca',
      humanReadableIdentifier: 'humanReadableVersion13'
    }
  ];
  const actual = await kes.getRetainedLambdaAliasMetadata();
  t.deepEqual(expected, actual);
});

test.serial('getHumanReadableIdentifier returns a packed ID from the descriptiohn string', (t) => {
  const testString = 'Some Description Here|version';
  const expected = 'version';
  const actual = t.context.kes.getHumanReadableIdentifier(testString);
  t.is(expected, actual);
});

test.serial("getHumanReadableIdentifier returns '' for a version string with no packed ID", (t) => {
  const testString = 'Some Bogus Version String';
  const expected = '';
  const actual = t.context.kes.getHumanReadableIdentifier(testString);
  t.is(expected, actual);
});


test.serial('setParentOverrideConfigValues merges defined parent configuration', (t) => {
  const parentConfig = { overrideKey: true };
  const kes = t.context.kes;
  kes.config.overrideKey = false;
  kes.config.override_with_parent = ['overrideKey'];
  kes.config.parent = parentConfig;

  kes.setParentOverrideConfigValues();
  const expected = true;
  const actual = kes.config.overrideKey;

  t.is(expected, actual);
});

test.serial('setParentOverrideConfigValues ignores missing parent configuration', (t) => {
  const parentConfig = {};
  const kes = t.context.kes;
  kes.config.overrideKey = false;
  kes.config.override_with_parent = ['overrideKey'];
  kes.config.parent = parentConfig;

  kes.setParentOverrideConfigValues();
  const expected = false;
  const actual = kes.config.overrideKey;

  t.is(expected, actual);
});


test.serial('addLambdaDeadLetterQueues adds dead letter queue to the sqs configuration', (t) => {
  const kes = t.context.kes;
  kes.config.lambdas.jobs.namedLambdaDeadLetterQueue = true;
  kes.config.DLQDefaultTimeout = 60;
  kes.config.DLQDefaultMessageRetentionPeriod = 5;
  kes.addLambdaDeadLetterQueues();

  const expected = {
    MessageRetentionPeriod: 5,
    visibilityTimeout: 60
  };

  const actual = kes.config.sqs.jobsDeadLetterQueue;
  t.deepEqual(expected, actual);
});

test.serial('addLambdaDeadLetterQueues adds dead letter queue to the sqs configuration', (t) => {
  const kes = t.context.kes;
  kes.config.lambdas.jobs.namedLambdaDeadLetterQueue = true;
  kes.addLambdaDeadLetterQueues();
  const actual = kes.config.lambdas.jobs.deadletterqueue;
  const expected = 'jobsDeadLetterQueue';
  t.is(expected, actual);
});

test.serial('buildCWDashboard creates alarm widgets', (t) => {
  const kes = t.context.kes;
  // each ECS service has a default alarm
  const ecsDefaultAlarmCount = Object.keys(kes.config.ecs.services).length;

  // custom ECS alarms
  const alarmReducer = (accumulator, serviceName) => {
    const service = kes.config.ecs.services[serviceName];
    const numberOfAlarms = (service.alarms) ? Object.keys(service.alarms).length : 0;
    return accumulator + numberOfAlarms;
  };

  const ecsCustomAlarmCount = Object.keys(kes.config.ecs.services).reduce(alarmReducer, 0);
  const esAlarmsCount = Object.keys(kes.config.es.alarms).length;

  const dashboardWithEs = kes.buildCWDashboard(kes.config.dashboard, kes.config.ecs, kes.config.es, 'mystack');
  const widgets = JSON.parse(dashboardWithEs).widgets;

  // widgets for alarms
  const alarmWidgets = widgets.filter((widget) => get(widget, 'properties.annotations.alarms'));
  t.is(alarmWidgets.length, ecsDefaultAlarmCount + ecsCustomAlarmCount + esAlarmsCount);

  // test no ES
  const dashboardNoEs = kes.buildCWDashboard(kes.config.dashboard, kes.config.ecs, null, 'mystack');
  const widgetsNoEs = JSON.parse(dashboardNoEs).widgets;
  const alarmWidgetsNoEs = widgetsNoEs.filter((widget) => get(widget, 'properties.annotations.alarms'));
  t.is(alarmWidgetsNoEs.length, ecsDefaultAlarmCount + ecsCustomAlarmCount);
});
