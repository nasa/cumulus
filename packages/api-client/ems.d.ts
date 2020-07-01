/**
 * Post a request to the ems API
 * POST /ems
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Object} params.request    - request body to post
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                   that takes a prefix / user payload.  Defaults
 *                                   to cumulusApiClient.invokeApifunction to invoke the api lambda
 * @returns {Promise<Object>}        - promise that resolves to the output of the API lambda
 */
export function createEmsReports({ prefix, request, callback }: {
  prefix: string;
  request: Object;
  callback: Function;
}): Promise<Object>;
/**
 * Fetch deployment's `ems_*` environment variables.
 *
 * @param {string} lambdaName - deployment prefix
 * @returns {Promise<Object>} map of ems_* lambda envs
 */
export function getLambdaEmsSettings(lambdaName: string): Promise<Object>;
//# sourceMappingURL=ems.d.ts.map
