'use strict';

const test = require('ava');
const configHelpers = require('../configHelpers');

test.beforeEach((t) => {
  t.context.config = {
    logsBucket: 'asdf',
    prefix: 'asdf',
    stack: 'asdf'
  };
  t.context.serverless = {};
});

test('deployToVpc() returns true if both vpcId and subnetIds are set', (t) => {
  const config = {
    ...t.context.config,
    vpcId: 'asdf',
    subnetIds: ['asdf']
  };

  t.true(configHelpers.deployToVpc(t.context.serverless, config));
});

test('deployToVpc() returns false if vpcId is set but subnetIds is not', (t) => {
  const config = {
    ...t.context.config,
    vpcId: 'asdf'
  };

  t.false(configHelpers.deployToVpc(t.context.serverless, config));
});

test('deployToVpc() returns false if subnetIds is set but vpcId is not', (t) => {
  const config = {
    ...t.context.config,
    subnetIds: ['asdf']
  };

  t.false(configHelpers.deployToVpc(t.context.serverless, config));
});

test('logsBucket() returns the configured value if set', (t) => {
  const config = {
    ...t.context.config,
    logsBucket: 'asdf'
  };

  t.is(configHelpers.logsBucket(t.context.serverless, config), 'asdf');
});

test('logsBucket() throws an exception if not set', (t) => {
  const config = { ...t.context.config };
  delete config.logsBucket;

  t.throws(
    () => configHelpers.logsBucket(t.context.serverless, config),
    'logsBucket must be set'
  );
});

test('logsBucket() throws an error if the configured value is not a string', (t) => {
  const config = {
    ...t.context.config,
    logsBucket: 5
  };

  t.throws(
    () => configHelpers.logsBucket(t.context.serverless, config),
    'logsBucket must be a string'
  );
});

test('logsPrefix() returns the configured value if set', (t) => {
  const config = {
    ...t.context.config,
    logsPrefix: 'asdf'
  };

  t.is(configHelpers.logsPrefix(t.context.serverless, config), 'asdf');
});

test('logsPrefix() returns space if logsPrefix is not set', (t) => {
  t.is(configHelpers.logsPrefix(t.context.serverless, t.context.config), '');
});

test('logsPrefix() throws an error if the configured value is not a string', (t) => {
  const config = {
    ...t.context.config,
    logsPrefix: 5
  };

  t.throws(
    () => configHelpers.logsPrefix(t.context.serverless, config),
    'logsPrefix must be a string'
  );
});

test('permissionsBoundary() returns the configured value if set', (t) => {
  const config = {
    ...t.context.config,
    permissionsBoundary: 'asdf'
  };

  t.is(configHelpers.permissionsBoundary(t.context.serverless, config), 'asdf');
});

test('permissionsBoundary() returns AWS::NoValue if logsPrefix is not set', (t) => {
  t.deepEqual(
    configHelpers.permissionsBoundary({}, t.context.config),
    { Ref: 'AWS::NoValue' }
  );
});

test('permissionsBoundary() throws an error if the configured value is not a string', (t) => {
  const config = {
    ...t.context.config,
    permissionsBoundary: {}
  };

  t.throws(
    () => configHelpers.permissionsBoundary(t.context.serverless, config),
    'permissionsBoundary must be a string'
  );
});

test('prefix() returns the configured value if set', (t) => {
  const config = {
    ...t.context.config,
    prefix: 'asdf'
  };

  t.is(configHelpers.prefix(t.context.serverless, config), 'asdf');
});

test('prefix() throws an exception if not set', (t) => {
  const config = { ...t.context.config };
  delete config.prefix;

  t.throws(
    () => configHelpers.prefix(t.context.serverless, config),
    'prefix must be set'
  );
});

test('prefix() throws an error if the configured value is not a string', (t) => {
  const config = {
    ...t.context.config,
    prefix: {}
  };

  t.throws(
    () => configHelpers.prefix(t.context.serverless, config),
    'prefix must be a string'
  );
});

test('stack() returns the configured value if set', (t) => {
  const config = {
    ...t.context.config,
    stack: 'asdf'
  };

  t.is(configHelpers.stack(t.context.serverless, config), 'asdf');
});

test('stack() throws an exception if not set', (t) => {
  const config = { ...t.context.config };
  delete config.stack;

  t.throws(
    () => configHelpers.stack(t.context.serverless, config),
    'stack must be set'
  );
});

test('stack() throws an error if the configured value is not a string', (t) => {
  const config = {
    ...t.context.config,
    stack: {}
  };

  t.throws(
    () => configHelpers.stack(t.context.serverless, config),
    'stack must be a string'
  );
});

test('subnetIds() returns the configured value if set', (t) => {
  const config = {
    ...t.context.config,
    subnetIds: ['asdf'],
    vpcId: 'v-123'
  };

  t.deepEqual(configHelpers.subnetIds(t.context.serverless, config), ['asdf']);
});

test('subnetIds() returns false if not set', (t) => {
  t.false(configHelpers.subnetIds(t.context.serverless, t.context.config));
});

test('subnetIds() throws an error if the configured value is not an array', (t) => {
  const config = {
    ...t.context.config,
    vpcId: 'v-123',
    subnetIds: 5
  };

  t.throws(
    () => configHelpers.subnetIds(t.context.serverless, config),
    'subnetIds must be an array of strings'
  );
});

test('subnetIds() throws an error if the configured value is not an array of strings', (t) => {
  const config = {
    ...t.context.config,
    vpcId: 'v-123',
    subnetIds: [5]
  };

  t.throws(
    () => configHelpers.subnetIds(t.context.serverless, config),
    'subnetIds must be an array of strings'
  );
});

test('subnetIds() throws an error if it is set but vpcId is not', (t) => {
  const config = {
    ...t.context.config,
    subnetIds: ['s-123']
  };

  t.throws(() => configHelpers.subnetIds(t.context.serverless, config));
});

test('vpcConfig() returns the correct value if deployToVpc returns true', (t) => {
  const config = {
    ...t.context.config,
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
  t.deepEqual(
    configHelpers.vpcConfig(t.context.serverless, t.context.config),
    { Ref: 'AWS::NoValue' }
  );
});

test('vpcConfig() throws an error if vpcId is set but subnetIds is not', (t) => {
  const config = {
    ...t.context.config,
    vpcId: 'v-123'
  };

  t.throws(
    () => configHelpers.vpcConfig(t.context.serverless, config),
    'Both vpcId and subnetIds must be set'
  );
});

test('vpcConfig() throws an error if subnetIds is set but vpcId is not', (t) => {
  const config = {
    ...t.context.config,
    subnetIds: ['subnet-123']
  };

  t.throws(
    () => configHelpers.vpcConfig(t.context.serverless, config),
    'Both vpcId and subnetIds must be set'
  );
});

test('vpcId() returns the configured value if set', (t) => {
  const config = {
    ...t.context.config,
    subnetIds: ['s-123'],
    vpcId: 'asdf'
  };

  t.deepEqual(configHelpers.vpcId(t.context.serverless, config), 'asdf');
});

test('vpcId() returns false if not set', (t) => {
  t.false(configHelpers.vpcId(t.context.serverless, t.context.config));
});

test('vpcId() throws an error if the configured value is not a string', (t) => {
  const config = { ...t.context.config, vpcId: 5 };

  t.throws(() => configHelpers.vpcId(t.context.serverless, config));
});

test('vpcId() throws an error if it is set but subnetIds is not', (t) => {
  const config = { ...t.context.config, vpcId: 5 };

  t.throws(() => configHelpers.vpcId(t.context.serverless, config));
});
