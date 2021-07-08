const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');
const db = require('@cumulus/db');

const { chooseTargetExecution } = require('../../lib/executions');

const randomArn = () => `arn_${cryptoRandomString({ length: 10 })}`;
const randomGranuleId = () => `granuleId_${cryptoRandomString({ length: 10 })}`;
const randomWorkflow = () => `workflow_${cryptoRandomString({ length: 10 })}`;

test.before((t) => {
  t.context.sandbox = sinon.createSandbox();
  t.context.arn = randomArn();
  const knexFake = sinon.fake.resolves('knex');
  const executionArnsFromGranuleIdsAndWorkflowNamesFake = sinon.fake.resolves([
    { arn: t.context.arn },
  ]);
  t.context.sandbox.replaceGetter(db, 'getKnexClient', knexFake);
  t.context.sandbox.replaceGetter(
    db,
    'executionArnsFromGranuleIdsAndWorkflowNames',
    executionArnsFromGranuleIdsAndWorkflowNamesFake
  );
});

test.after.always((t) => {
  t.context.sandbox.restore();
});

test('chooseTargetExecution() returns executionArn if provided.', async (t) => {
  const executionArn = randomArn();
  const granuleId = randomGranuleId();
  const expected = executionArn;

  const actual = await chooseTargetExecution(granuleId, executionArn);

  t.is(expected, actual);
});

test('chooseTargetExecution() returns undefined if no executionarn nor workflowName are provided.', async (t) => {
  const granuleId = randomGranuleId();
  const expected = undefined;

  const actual = await chooseTargetExecution(granuleId);

  t.is(expected, actual);
});

test('chooseTargetExecution() returns the first arn found in the database if a workflowName is provided.', async (t) => {
  const workflowName = randomWorkflow();
  const granuleId = randomGranuleId();

  const actual = await chooseTargetExecution(
    granuleId,
    undefined,
    workflowName
  );

  t.is(actual[0].arn, t.context.arn);
});
