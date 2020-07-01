/**
 * GET /reconciliationReports/{name}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.name        - report record name
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the report fetched by the API
 */
export function getReconciliationReport({ prefix, name, callback }: {
  prefix: string;
  name: string;
  callback: Function;
}): Promise<Object>;
/**
 * Delete a reconciliation report from Cumulus via the API lambda
 * DELETE /reconciliationReports/${name}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.name        - report record name
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApi function to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
export function deleteReconciliationReport({ prefix, name, callback }: {
  prefix: string;
  name: string;
  callback: Function;
}): Promise<Object>;
/**
 * Post a request to the reconciliationReports API
 * POST /reconciliationReports
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Object} params.request    - request body to post
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                   that takes a prefix / user payload.  Defaults
 *                                   to cumulusApiClient.invokeApifunction to invoke the api lambda
 * @returns {Promise<Object>}        - promise that resolves to the output of the API lambda
 */
export function createReconciliationReport({ prefix, request, callback }: {
  prefix: string;
  request: Object;
  callback: Function;
}): Promise<Object>;
//# sourceMappingURL=reconciliationReports.d.ts.map
