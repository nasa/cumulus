/**
 * Fetch an execution from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution fetched by the API
 */
export function getExecution({ prefix, arn, callback }: {
  prefix: string;
  arn: string;
  callback: Function;
}): Promise<Object>;
/**
 * Fetch a list of executions from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution list fetched by the API
 */
export function getExecutions({ prefix, callback }: {
  prefix: string;
  callback: Function;
}): Promise<Object>;
/**
 * get execution status from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution status fetched by the API
 */
export function getExecutionStatus({ prefix, arn, callback }: {
  prefix: string;
  arn: string;
  callback: Function;
}): Promise<Object>;
//# sourceMappingURL=executions.d.ts.map
