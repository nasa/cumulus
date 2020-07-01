/**
 * GET /granules/{granuleName}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export function getGranule({ prefix, granuleId, callback }: {
  prefix: string;
  granuleId: string;
  callback: Function;
}): Promise<Object>;
/**
 * Reingest a granule from the Cumulus API
 * PUT /granules/{}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export function reingestGranule({ prefix, granuleId, callback }: {
  prefix: string;
  granuleId: string;
  callback: Function;
}): Promise<Object>;
/**
 * Removes a granule from CMR via the Cumulus API
 * PUT /granules/{granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export function removeFromCMR({ prefix, granuleId, callback }: {
  prefix: string;
  granuleId: string;
  callback: Function;
}): Promise<Object>;
/**
 * Run a workflow with the given granule as the payload
 * PUT /granules/{granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {string} params.workflow    - workflow to be run with given granule
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the granule fetched by the API
 */
export function applyWorkflow({ prefix, granuleId, workflow, callback }: {
  prefix: string;
  granuleId: string;
  workflow: string;
  callback: Function;
}): Promise<Object>;
/**
 * Delete a granule from Cumulus via the API lambda
 * DELETE /granules/${granuleId}
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
export function deleteGranule({ prefix, granuleId, callback }: {
  prefix: string;
  granuleId: string;
  callback: Function;
}): Promise<Object>;
/**
 * Query  granules stored in cumulus
 * GET /granules
 * @param {Object} params             - params
 * @param {string} params.query       - query to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export function listGranules({ prefix, query, callback }: {
  query: string;
  callback: Function;
}): Promise<Object>;
/**
 * Move a granule via the API
 * PUT /granules/{granuleId}
 *
 * @param {Object} params                       - params
 * @param {string} params.prefix                - the prefix configured for the stack
 * @param {string} params.granuleId             - a granule ID
 * @param {Array<Object>} params.destinations   - move granule destinations
 * @param {Function} params.callback            - async function to invoke the api lambda
 *                                                that takes a prefix / user payload.  Defaults
 *                                                to cumulusApiClient.invokeApifunction to invoke
 *                                                the api lambda
 * @returns {Promise<Object>}                   - the move response from the API
 */
export function moveGranule({ prefix, granuleId, destinations, callback }: {
  prefix: string;
  granuleId: string;
  destinations: Array<Object>;
  callback: Function;
}): Promise<Object>;
/**
 * Wait for a granule to be present in the database (using pRetry)
 *
 * @param {Object} params             - params
 * @param {string} params.granuleId   - granuleId to wait for
 * @param {number} params.retries     - number of times to retry
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 */
export function waitForGranule({ prefix, granuleId, status, retries, callback }: {
  granuleId: string;
  retries: number;
  callback: Function;
}): Promise<void>;
/**
 * Removed a granule from CMR and delete from Cumulus via the API
 *
 * @param {Object} params             - params
 * @param {string} params.prefix      - the prefix configured for the stack
 * @param {string} params.granuleId   - a granule ID
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the delete confirmation from the API
 */
export function removePublishedGranule({ prefix, granuleId, callback }: {
  prefix: string;
  granuleId: string;
  callback: Function;
}): Promise<Object>;
/**
 * Bulk delete granules stored in cumulus
 * POST /granules/bulkDelete
 * @param {Object} params             - params
 * @param {Object} params.body       - body to pass the API lambda
 * @param {Function} params.callback  - async function to invoke the api lambda
 *                                      that takes a prefix / user payload.  Defaults
 *                                      to cumulusApiClient.invokeApifunction to invoke the
 *                                      api lambda
 * @returns {Promise<Object>}         - the response from the callback
 */
export function bulkDeleteGranules({ prefix, body, callback }: {
  body: Object;
  callback: Function;
}): Promise<Object>;
//# sourceMappingURL=granules.d.ts.map
