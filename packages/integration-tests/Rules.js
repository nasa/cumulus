'use strict';

/**
 * @module Rules
 *
 * @example
 * const Rules = require('@cumulus/integration-test/Rules');
 */

const rulesApi = require('@cumulus/api-client/rules');
const { randomId } = require('@cumulus/common/test-utils');

const buildRule = (overrides = {}) => ({
  name: randomId('rule_'),
  ...overrides,
});

const buildOneTimeRule = (overrides = {}) =>
  buildRule({
    ...overrides,
    rule: {
      type: 'onetime',
    },
  });

/**
 * Create a `onetime` rule using the Cumulus API
 *
 * **Rule defaults:**
 *
 * - **name**: random string starting with `rule_`
 * - **rule**: `{ type: 'onetime' }`
 *
 * @param {string} prefix - the name of the Cumulus stack
 * @param {Object} [overrides] - properties to set on the rule, overriding the defaults
 * @returns {Promise<Object>} the generated rule
 *
 * @alias module:Rules
 */
const createOneTimeRule = async (prefix, overrides = {}) => {
  const rule = buildOneTimeRule(overrides);

  const createResponse = await rulesApi.postRule({ prefix, rule });

  if (createResponse.statusCode !== 200) {
    throw new Error(`Failed to create rule: ${JSON.stringify(createResponse)}`);
  }
  return JSON.parse(createResponse.body).record;
};

module.exports = {
  createOneTimeRule,
};
