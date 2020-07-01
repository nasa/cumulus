/**
 * Invoke the Cumulus private API lambda (using pRetry)
 *
 * @param {Object} params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.payload .  - the payload object (e.g. httpMethod, resource,
 *                                     headers, path, body) containing params the lambda expects
 *                                     in the payload
 * @returns {Promise<Object>}        - Returns promise that resolves to the output payload from the
 *                                     API lambda
 */
export function invokeApi({ prefix, payload }: {
  prefix: string;
  payload: string;
}): Promise<Object>;
//# sourceMappingURL=cumulusApiClient.d.ts.map
