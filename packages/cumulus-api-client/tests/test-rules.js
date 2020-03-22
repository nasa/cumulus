'use strict';

const test = require('ava');
const rewire = require('rewire');
const rulesRewire = rewire('../rules');


test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testName = 'testRule';
  t.context.testRule = { some: 'ruleObject' };
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
  let revertCallback;
  try {
    revertCallback = rulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(rulesRewire.postRule({
      prefix: t.context.testPrefix,
      rule: t.context.testRule
    }));
  } finally {
    revertCallback();
  }
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

  let revertCallback;
  try {
    revertCallback = rulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(rulesRewire.updateRule({
      prefix: t.context.testPrefix,
      ruleName: t.context.testName,
      updateParams: t.context.updateParams
    }));
  } finally {
    revertCallback();
  }
});

test('listRules calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/rules',
      queryStringParameters: {}
    }
  };
  const callback = async (configObject) => {
    t.deepEqual(expected, configObject);
  };

  let revertCallback;
  try {
    revertCallback = rulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(rulesRewire.listRules({
      prefix: t.context.testPrefix
    }));
  } finally {
    revertCallback();
  }
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

  let revertCallback;
  try {
    revertCallback = rulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(rulesRewire.getRule({
      prefix: t.context.testPrefix,
      ruleName: t.context.testName
    }));
  } finally {
    revertCallback();
  }
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

  let revertCallback;
  try {
    revertCallback = rulesRewire.__set__('invokeApi', callback);
    await t.notThrowsAsync(rulesRewire.deleteRule({
      prefix: t.context.testPrefix,
      ruleName: t.context.testName
    }));
  } finally {
    revertCallback();
  }
});

test.serial('rerunRule calls the updateRule with the expected object', async (t) => {
  let revertUpdateRule;
  let revertCallback;
  try {
    const expected = {
      prefix: t.context.testPrefix,
      ruleName: t.context.testName,
      updateParams: { action: 'rerun' },
    };

    const callback = async (configObject) => {
      t.deepEqual(expected, configObject);
    };

    revertCallback = rulesRewire.__set__('invokeApi', callback);
    revertUpdateRule = rulesRewire.__set__('updateRule', async (configObject) => {
      t.deepEqual({ ...expected, callback }, configObject);
    });
    await t.notThrowsAsync(rulesRewire.rerunRule({
      prefix: t.context.testPrefix,
      ruleName: t.context.testName,
    }));
  } finally {
    revertUpdateRule();
    revertCallback();
  }
});


test('callRuleApiFunction throws an error if callback throws an error', async (t) => {
  const callback = async () => {
    throw new Error('test error');
  };
  await t.throwsAsync(rulesRewire.__get__('callRuleApiFunction')(t.context.testPrefix, {}, callback), Error, 'test error');
});

test('callRuleApiFunction returns the payload if the callback returns', async (t) => {
  const expected = { some: 'payload' };
  const callback = async () => expected;
  let revertCallback;
  try {
    revertCallback = rulesRewire.__set__('invokeApi', callback);
    const actual = await rulesRewire.__get__('callRuleApiFunction')(t.context.testPrefix, {});
    t.deepEqual(expected, actual);
  } finally {
    revertCallback();
  }
});
