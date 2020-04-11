'use strict';

const rulesApi = require('@cumulus/api-client/rules');
const { randomId } = require('@cumulus/common/test-utils');

const buildRule = (overrides = {}) => ({
  name: randomId('rule_'),
  ...overrides
});

const buildOneTimeRule = (overrides = {}) =>
  buildRule({
    ...overrides,
    rule: {
      type: 'onetime'
    }
  });

const createOneTimeRule = async (prefix, overrides = {}) => {
  const rule = buildOneTimeRule(overrides);

  const createResponse = await rulesApi.postRule({ prefix, rule });

  if (createResponse.statusCode !== 200) {
    throw new Error(`Failed to create rule: ${JSON.stringify(createResponse)}`);
  }

  return rule;
};

module.exports = {
  createOneTimeRule
};
