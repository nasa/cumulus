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

/**
 * Build a onetime rule and create it using the Cumulus API
 *
 * See the `@cumulus/integration-tests` README for more information
 *
 * @param {string} prefix - the Cumulus stack name
 * @param {Object} overrides - properties to set on the rule, overriding the
 *   defaults
 * @returns {Promise<Object>} the generated rule
 */
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
