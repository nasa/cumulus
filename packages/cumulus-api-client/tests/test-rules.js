'use strict';

const test = require('ava');
const rewire = require('rewire');
const rulesRewire = rewire('../rules');


test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testName = 'testRule';
  t.context.testRule = { some: "ruleObject" };
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
        'Content-Type': 'application/json'
      },
      path: '/rules',
      body: JSON.stringify(t.context.testRule)
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(rulesRewire.postRule({
    prefix: t.context.testPrefix,
    rule: t.context.testRule,
    callback
  }));
});

test('updateRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json'
      },
      path: `/rules/${t.context.testName}`,
      body: JSON.stringify(t.context.updateParams)
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(rulesRewire.updateRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    updateParams: t.context.updateParams,
    callback
  }));
});

test('listRules calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/rules',
      queryStringParameters: t.context.testQuery
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(rulesRewire.listRules({
    prefix: t.context.testPrefix,
    query: t.context.testQuery,
    callback
  }));
});

test('getRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/rules/${t.context.testName}`
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(rulesRewire.getRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback
  }));
});

test('deleteRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/rules/${t.context.testName}`
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  await t.notThrowsAsync(rulesRewire.deleteRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback
  }));
});

test.serial('rerunRule calls the updateRule with the expected object', async (t) => {
  let revertUpdateRule;
  try {
    const expected = {
      prefix: t.context.testPrefix,
      ruleName: t.context.testName,
      updateParams: { ...t.context.updateParams, action: 'rerun' },
    };

    const callback = async (configObject) => {
      t.deepEqual(expected, configObject);
    };

    revertUpdateRule = rulesRewire.__set__('updateRule', async (configObject) => {
      t.deepEqual({ ...expected, callback }, configObject);
    });

    await t.notThrowsAsync(rulesRewire.rerunRule({
      prefix: t.context.testPrefix,
      ruleName: t.context.testName,
      updateParams: t.context.updateParams,
      callback
    }));
  } finally {
    revertUpdateRule();
  }
});
