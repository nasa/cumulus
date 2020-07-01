/**
 * Fetch a workflow from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.workflowName
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
export function getWorkflow({ prefix, workflowName, callback }: {
  prefix: string;
  workflowName: string;
  callback: Function;
}): Promise<Object>;
/**
 * Fetch a list of workflows from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the list of workflows fetched by the API
 */
export function getWorkflows({ prefix, callback }: {
  prefix: string;
}): Promise<Object>;
//# sourceMappingURL=workflows.d.ts.map
