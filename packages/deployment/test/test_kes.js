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


test('getRetainedLambdaAliasNames returns filtered aliasNames', async (test) => {
  const aliasFixture = require('./fixtures/aliases.json');
  let kes = test.context.kes;
  kes.config.lambdas = aliasFixture.Lambdas;

  // Setup stubs for AWS methods in getReetainedLambdaAliasNames
  const listAliasesStub = sinon.stub().callsFake(() => Promise.reject());
  for(let i=0; i < Object.keys(aliasFixture).length; i++) {
    listAliasesStub.onCall(i).returns(Promise.resolve({Aliases: aliasFixture.Aliases[i]}));
  }

  sinon.stub(kes.AWS, 'Lambda').callsFake(function () {
    return { listAliases: function (config) {
        return { promise: listAliasesStub };
    }};
  });

  let expected = [ 'VersionUpTest-PreviousVersionHash',
                   'VersionUpTest-SecondPreviousVersionHash',
                   'HelloWorld-d49d272b8b1e8eb98a61affc34b1732c1032b1ca' ];
  let actual = await kes.getRetainedLambdaAliasNames();
  test.deepEqual(expected, actual);
});
