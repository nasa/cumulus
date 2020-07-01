/**
 * Create a provider via the API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.provider   - provider object
 * @param {Function} params.callback - function to invoke the api lambda
 *                                     that takes a prefix / user payload
 * @returns {Promise<Object>}        - promise that resolves to the output of the callback
 */
export function createProvider({ prefix, provider, callback }: {
  prefix: string;
  provider: string;
  callback: Function;
}): Promise<Object>;
/**
 * Delete a provider from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.providerId   - a provider id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the callback
 */
export function deleteProvider({ prefix, providerId, callback }: {
  prefix: string;
  providerId: string;
  callback: Function;
}): Promise<Object>;
/**
 * Fetch a provider from the Cumulus API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.providerId   - a provider id
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
export function getProvider({ prefix, providerId, callback }: {
  prefix: string;
  providerId: string;
  callback: Function;
}): Promise<Object>;
/**
 * Fetch a list of providers from the Cumulus API
 *
 * @param {Object} params - params
 * @param {string} params.prefix - the prefix configured for the stack
 * @returns {Promise<Object>} - the list of providers fetched by the API
 */
export function getProviders({ prefix, callback }: {
  prefix: string;
}): Promise<Object>;
//# sourceMappingURL=providers.d.ts.map
