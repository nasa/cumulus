const pWaitFor = require('p-wait-for');
const { listRules } = require('@cumulus/integration-tests/api/rules');

/**
 * Wait for the defined rule to exist in the rules list.
 *
 * @param {string} stackName - Deployment name
 * @param {Object} ruleQueryParams
 *   Query params to use for search in rules listing
 * @returns {Promise}
 */
const waitForRuleInList = async (stackName, ruleQueryParams) => pWaitFor(
  async () => {
    const resp = await listRules({
      prefix: stackName,
      query: ruleQueryParams
    });
    return JSON.parse(resp.body).results.length > 0;
  },
  {
    interval: 3000,
    timeout: 30 * 1000
  }
);

module.exports = {
  waitForRuleInList
};
