/**
 * POST /collections
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.collection   - collection object to add to the database
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
export function createCollection({ prefix, collection, callback }: {
  prefix: string;
  collection: Object;
  callback: Function;
}): Promise<Object>;
/**
 * DELETE /collections/{collectionName}/{collectionVersion}
 *
 * @param {Object} params                     - params
 * @param {string} params.prefix              - the prefix configured for the stack
 * @param {Object} params.collectionVersion   - name of collection to delete
 * @param {Object} params.collectionName      - version of collection to delete
 * @param {Function} params.callback          - async function to invoke the api lambda
 *                                            that takes a prefix / user payload.  Defaults
 *                                            to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}                 - the response from the callback
 */
export function deleteCollection({ prefix, collectionName, collectionVersion, callback }: {
  prefix: string;
  collectionVersion: Object;
  collectionName: Object;
  callback: Function;
}): Promise<Object>;
/**
 * Get a collection from Cumulus via the API lambda
 * GET /collections/{vollectionName}/{collectionVersion}
 *
 * @param {Object} params                     - params
 * @param {string} params.prefix              - the prefix configured for the stack
 * @param {Object} params.collectionVersion   - name of collection to get
 * @param {Object} params.collectionName      - version of collection to get
 * @param {Function} params.callback          - async function to invoke the api lambda
 *                                              that takes a prefix / user payload.  Defaults
 *                                              to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}                 - the response from the callback
 */
export function getCollection({ prefix, collectionName, collectionVersion, callback }: {
  prefix: string;
  collectionVersion: Object;
  collectionName: Object;
  callback: Function;
}): Promise<Object>;
/**
 * Get a list of collection from Cumulus via the API lambda
 * GET /collections
 *
 * @param {Object} params                     - params
 * @param {string} params.prefix              - the prefix configured for the stack
 * @param {Function} params.callback          - async function to invoke the api lambda
 *                                              that takes a prefix / user payload.  Defaults
 *                                              to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}                 - the response from the callback
 */
export function getCollections({ prefix, callback }: {
  prefix: string;
  callback: Function;
}): Promise<Object>;
//# sourceMappingURL=collections.d.ts.map
