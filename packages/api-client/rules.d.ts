/**
 * Post a rule to the rules API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.rule         - rule body to post
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
export function postRule({ prefix, rule, callback }: {
  prefix: string;
  rule: Object;
  callback: Function;
}): Promise<Object>;
/**
 * Update a rule in the rules API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.ruleName     - the rule to update
 * @param {Object} params.updateParams - key/value to update on the rule
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output of the API lambda
 */
export function updateRule({ prefix, ruleName, updateParams, callback }: {
  prefix: string;
  ruleName: Object;
  updateParams: Object;
  callback: Function;
}): Promise<Object>;
/**
 * Delete a rule via the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.ruleName - name of the rule
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
export function deleteRule({ prefix, ruleName, callback }: {
  prefix: string;
  ruleName: string;
  callback: Object;
}): Promise<Object>;
/**
 * Get a rule definition from the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.ruleName - name of the rule
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>}      - promise that resolves to the output of the
 *                                   API lambda
 */
export function getRule({ prefix, ruleName, callback }: {
  prefix: string;
  ruleName: string;
  callback: Object;
}): Promise<Object>;
/**
 * Get a list of rules from the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.query    - query params to use for listing rules
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
export function listRules({ prefix, query, callback }: {
  prefix: string;
  query: string;
  callback: Object;
}): Promise<Object>;
/**
 * Rerun a rule via the API.
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.ruleName     - the name of the rule to rerun
 * @param {Object} params.updateParams - key/value to update on the rule
 * @param {Object} params.callback     - function to invoke the api lambda
 *                                       that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API
 *    lambda
 */
export function rerunRule({ prefix, ruleName, updateParams, callback }: {
  prefix: string;
  ruleName: string;
  updateParams: Object;
  callback: Object;
}): Promise<Object>;
//# sourceMappingURL=rules.d.ts.map
