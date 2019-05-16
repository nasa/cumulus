'use strict';

const test = require('ava');
const configHelpers = require('../configHelpers');

test.beforeEach((t) => {
  t.context.serverless = {};
});

test('deploymentBucket() returns the configured value if set', (t) => {
  const config = { deploymentBucket: 'asdf' };

  t.is(configHelpers.deploymentBucket(t.context.serverless, config), 'asdf');
});

test('deploymentBucket() returns false if not set', (t) => {
  const config = {};

  t.false(configHelpers.deploymentBucket(t.context.serverless, config));
});

test('deployToVpc() returns true if both vpcId and subnetIds are set', (t) => {
  const config = {
    vpcId: 'asdf',
    subnetIds: ['asdf']
  };

  t.true(configHelpers.deployToVpc(t.context.serverless, config));
});

test('deployToVpc() returns false if vpcId is set but subnetIds is not', (t) => {
  const config = { vpcId: 'asdf' };

  t.false(configHelpers.deployToVpc(t.context.serverless, config));
});

test('deployToVpc() returns false if subnetIds is set but vpcId is not', (t) => {
  const config = { subnetIds: ['asdf'] };

  t.false(configHelpers.deployToVpc(t.context.serverless, config));
});

test('logsBucket() returns the configured value if set', (t) => {
  const config = { logsBucket: 'asdf' };

  t.is(configHelpers.logsBucket(t.context.serverless, config), 'asdf');
});

test('logsBucket() throws an exception if not set', (t) => {
  const config = {};

  t.throws(() => configHelpers.logsBucket(t.context.serverless, config));
});

test('logsPrefix() returns the configured value if set', (t) => {
  const config = { logsPrefix: 'asdf' };

  t.is(configHelpers.logsPrefix(t.context.serverless, config), 'asdf');
});

test('logsPrefix() returns space if logsPrefix is not set', (t) => {
  const config = {};

  t.is(configHelpers.logsPrefix(t.context.serverless, config), '');
});

test('permissionsBoundary() returns the configured value if set', (t) => {
  const config = { permissionsBoundary: 'asdf' };

  t.is(configHelpers.permissionsBoundary(t.context.serverless, config), 'asdf');
});

test('permissionsBoundary() returns AWS::NoValue if logsPrefix is not set', (t) => {
  const config = {};

  t.deepEqual(
    configHelpers.permissionsBoundary({}, config),
    { Ref: 'AWS::NoValue' }
  );
});

test('prefix() returns the configured value if set', (t) => {
  const config = { prefix: 'asdf' };

  t.is(configHelpers.prefix(t.context.serverless, config), 'asdf');
});

test('prefix() throws an exception if not set', (t) => {
  const config = {};

  t.throws(() => configHelpers.prefix(t.context.serverless, config));
});

test('stack() returns the configured value if set', (t) => {
  const config = { stack: 'asdf' };

  t.is(configHelpers.stack(t.context.serverless, config), 'asdf');
});

test('stack() throws an exception if not set', (t) => {
  const config = {};

  t.throws(() => configHelpers.stack(t.context.serverless, config));
});

test('subnetIds() returns the configured value if set', (t) => {
  const config = { subnetIds: ['asdf'] };

  t.deepEqual(configHelpers.subnetIds(t.context.serverless, config), ['asdf']);
});

test('subnetIds() returns false if not set', (t) => {
  const config = {};

  t.false(configHelpers.subnetIds(t.context.serverless, config));
});

test('vpcConfig() returns the correct value if deployToVpc returns true', (t) => {
  const config = {
    vpcId: 'v-123',
    subnetIds: ['s-123']
  };

  t.deepEqual(
    configHelpers.vpcConfig(t.context.serverless, config),
    {
      securityGroupIds: [
        { 'Fn::GetAtt': ['LambdaSecurityGroup', 'GroupId'] }
      ],
      subnetIds: ['s-123']
    }
  );
});

test('vpcConfig() returns AWS::NoValue if deployToVpc returns false', (t) => {
  const config = {};

  t.deepEqual(
    configHelpers.vpcConfig(t.context.serverless, config),
    { Ref: 'AWS::NoValue' }
  );
});

test('vpcId() returns the configured value if set', (t) => {
  const config = { vpcId: 'asdf' };

  t.deepEqual(configHelpers.vpcId(t.context.serverless, config), 'asdf');
});

test('vpcId() returns false if not set', (t) => {
  const config = {};

  t.false(configHelpers.vpcId(t.context.serverless, config));
});
