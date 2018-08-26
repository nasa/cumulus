/* eslint-disable no-console, no-param-reassign */

'use strict';

const sinon = require('sinon');
const test = require('ava');

const configFixture = require('./fixtures/config.json');
const UpdatedKes = require('../lib/kes');


test.beforeEach((test) => {
  test.context.kes = new UpdatedKes(configFixture);
});


function setupKesForLookupLambdaReference(kes, functionName, hashValue) {
  let lambdaFixture = {};
  lambdaFixture[functionName] = { hash: hashValue };
  kes.config.lambdas = lambdaFixture;
  return kes;
}

test('lookupLambdaReference returns the expected alias resource string', (test) => {
  const resourceString = '${FunctionNameLambdaFunction.Arn}';
  const kes = setupKesForLookupLambdaReference(test.context.kes,
                                           'FunctionName',
                                           'notarealhash');
  let result = kes.lookupLambdaReference(resourceString);
  test.is(result, '${FunctionNameLambdaAliasnotarealhash}');
});

test('lookupLambdaReference returns the original ', (test) => {
  const resourceString = '${FunctionNameLambdaFunction.Arn}';
  const kes = setupKesForLookupLambdaReference(test.context.kes, 'FunctionName', null);
  let result = kes.lookupLambdaReference(resourceString);
  test.is(result, resourceString);
});

test('lookupLambdaReference throws error on invalid configuration', (test) => {
  const resourceString = '${SomeOtherConfigurationString.foobar}';
  const kes = setupKesForLookupLambdaReference(test.context.kes, 'FunctionName', null);
  const error = test.throws(() => {
    kes.lookupLambdaReference(resourceString);
  }, Error);
  test.is(error.message, `Invalid stateObjectResource: ${resourceString}`);
});

test('injectWorkflowLambdaAliases updates the correct resources', (test) => {
  let kes = test.context.kes;

  kes.config.lambdas = {
    TestLambda: { hash: 'notarealhash' },
    TestUnversionedLambda: { hash: null }
  };

  kes.config.stepFunctions = {
    TestStepFunction: {
      States: {
        1: { Type: 'Task', Resource: '${TestLambdaLambdaFunction.Arn}' },
        2: { Type: 'Task', Resource: '${TestUnversionedLambdaLambdaFunction.Arn}' },
        3: { Type: 'Task', Resource: '${SomethingElse.Arn}'}
      }
    }
  };

  let expected = {
    TestStepFunction: {
      States: {
        1: { Type: 'Task', Resource: '${TestLambdaLambdaAliasnotarealhash}' },
        2: { Type: 'Task', Resource: '${TestUnversionedLambdaLambdaFunction.Arn}' },
        3: { Type: 'Task', Resource: '${SomethingElse.Arn}'}
      }
    }
  };

  kes.injectWorkflowLambdaAliases();
  test.deepEqual(expected, kes.config.stepFunctions);
});


test('injectOldWorkflowLambdaAliases adds oldLambdas to configuration object', async (test) => {
  const aliasFunc = () => {new Promise((resolve, reject) => resolve());};
  let kes = test.context.kes;

  kes.getRetainedLambdaAliasNames = () =>  Promise.resolve(['LambdaName-12345',
                                                            'LambdaName-abcde',
                                                            'SecondLambdaName-67890']);
  const expected = { LambdaName: { hashes: ['12345', 'abcde'] },
                     SecondLambdaName: { hashes: ['67890'] } };

  await kes.injectOldWorkflowLambdaAliases();
  test.deepEqual(expected, kes.config.oldLambdas);
});


test('parseAliasName parses the alias name', (test) => {
  const expected = {name: 'functionName', hash: 'hashValue'};
  const actual = test.context.kes.parseAliasName('functionName-hashValue');
  test.deepEqual(expected, actual);
});

test('parseAliasName returns null hash if hash missing', (test) => {
  const expected = {name: 'functionName', hash: null};
  const actual = test.context.kes.parseAliasName('functionName-');
  test.deepEqual(expected, actual);
});


test.serial('getAllLambdaAliases returns an unpaginated list of aliases', async (test) => {
  let kes = test.context.kes;

  // Mock out AWS calls
  const aliasFixture = require('./fixtures/aliases.json');
  const versionUpAliases = aliasFixture.Aliases[0];
  sinon.stub(kes.AWS, 'Lambda').callsFake(function () {
    return { listAliases: function (config) {
        return { promise: listAliasesStub };
    }};
  });
  const listAliasesStub = sinon.stub().callsFake(() => Promise.reject());
  for(let i=0; i < versionUpAliases.length-1; i++) {
    listAliasesStub.onCall(i).returns(Promise.resolve({
      NextMarker: 'mocked out',
      Aliases: [versionUpAliases[i]]
    }));
  }
  listAliasesStub.onCall(versionUpAliases.length-1).returns(
    Promise.resolve({Aliases: [versionUpAliases[versionUpAliases.length-1]]}));

  const lambda = kes.AWS.Lambda();
  const config = { MaxItems: 1, FunctionName: 'Mocked' };

  let actual = await kes.getAllLambdaAliases(lambda, config);

  test.deepEqual(versionUpAliases, actual,
                 `Expected:${JSON.stringify(versionUpAliases)}\n\n` +
                 `Actual:${JSON.stringify(actual)}`);
});

test.serial('getRetainedLambdaAliasNames returns filtered aliasNames', async (test) => {
  const aliasFixture = require('./fixtures/aliases.json');
  let kes = test.context.kes;

  kes.config.lambdas = aliasFixture.Lambdas;
  const getAllLambdaAliasesStub  = sinon.stub(kes, 'getAllLambdaAliases');
  for(let i=0; i<aliasFixture.Aliases.length; i++) {
    getAllLambdaAliasesStub.onCall(i).returns(aliasFixture.Aliases[i]);
  }

  let expected = [ 'VersionUpTest-PreviousVersionHash',
                   'VersionUpTest-SecondPreviousVersionHash',
                   'HelloWorld-d49d272b8b1e8eb98a61affc34b1732c1032b1ca' ];
  let actual = await kes.getRetainedLambdaAliasNames();
  test.deepEqual(expected, actual);
});
