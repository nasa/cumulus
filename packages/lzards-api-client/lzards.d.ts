import { LzardsApiGetRequestParameters } from './types';
/**
 * Retrieve Launchpad Auth Token
 *
 * @param {Function} getSecretStringFunction - function used to retrieve a secret from AWS
 * @param {Function} getLaunchpadTokenFunction - function used to retrieve cached Launchpad token
 * @returns {Promise<string>} - resolves to a Launchpad Token string
 */
export declare function getAuthToken(getSecretStringFunction?: any, getLaunchpadTokenFunction?: any): Promise<any>;
/**
 * Submit query to LZARDS
 *
 * @param {Object}   params
 * @param {string}   params.lzardsApiUri - LZARDS endpoint url
 * @param {Object}   params.searchParams -  object containing search parameters to pass to lzards
 * @param {Function} params.getAuthTokenFunction - function used to get a launchpad auth token
 * @returns {Promise<Object>} - resolves to the LZARDS return
 */
export declare function submitQueryToLzards({ searchParams, getAuthTokenFunction, }: LzardsApiGetRequestParameters): Promise<any>;
//# sourceMappingURL=lzards.d.ts.map