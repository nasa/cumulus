'use strict';

const test = require('ava');
const rulesApi = require('../rules');

test.before((t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testName = 'testRule';
  t.context.testRule = { some: 'ruleObject' };
  t.context.testReplacementRule = { replacement: 'replacementRule' };
  t.context.updateParams = '{ "Param1": "value 1" }';
  t.context.arn = 'testArn';
  t.context.testQuery = { testQueryKey: 'test query value' };
});

test('postRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/rules',
      body: JSON.stringify(t.context.testRule),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.postRule({
    prefix: t.context.testPrefix,
    rule: t.context.testRule,
    callback,
  }));
});

test('replaceRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      path: `/rules/${t.context.testName}`,
      body: JSON.stringify(t.context.testReplacementRule),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.replaceRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    replacementRule: t.context.testReplacementRule,
    callback,
  }));
});

test('updateRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
        'Cumulus-API-Version': '2',
      },
      path: `/rules/${t.context.testName}`,
      body: JSON.stringify(t.context.updateParams),
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.updateRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    updateParams: t.context.updateParams,
    callback,
  }));
});

test('listRules calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/rules',
      queryStringParameters: {},
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.listRules({
    prefix: t.context.testPrefix,
    callback,
  }));
});

test('getRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/rules/${t.context.testName}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.getRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback,
  }));
});

test('deleteRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/rules/${t.context.testName}`,
    },
  };

  const callback = (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.deleteRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback,
  }));
});

test('rerunRule calls the updateRule with the expected object', async (t) => {
  const expected = {
    httpMethod: 'PATCH',
    resource: '/{proxy+}',
    headers: {
      'Content-Type': 'application/json',
      'Cumulus-API-Version': '2',
    },
    path: `/rules/${t.context.testName}`,
    body: JSON.stringify({ action: 'rerun' }),
  };

  const callback = ({ payload }) => {
    t.deepEqual(payload, expected);
  };

  await t.notThrowsAsync(rulesApi.rerunRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback,
  }));
});
