import * as z from 'zod';
import got, { Response, HTTPError } from 'got';
const parseCaughtError = require('@cumulus/common');

const TokenSchema = z.object({
  access_token: z.string(),
  expiration_date: z.string(),
});

const PostTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expiration_date: z.string(),
});

type Token = z.infer<typeof TokenSchema>;

const GetTokenResponseBody = z.array(TokenSchema);

const PostTokenResponseBody = z.tuple([PostTokenSchema]);

/**
 * When another function calls this method and passes the expected JSON Web
 * Token, which Earthdata Login API returns and uses, the token's payload is parsed and
 * the exp field (the number of seconds after January 1st, 1970) is returned to be compared
 * against other dates. For example:
 *
 *    returnJWTexp(token) -> 1677775742859, assuming token is a valid JSON Web Token
 *
 * This value is used to compare against other tokens' expiration date's and the
 * current date to determine whether a token is expired or which token (the fresher token)
 * should be returned.
 *
 * @returns {number} the token payload's exp
 */

const returnJWTexp = (token: string) : number =>
  JSON.parse(Buffer.from(JSON.stringify(token).split('.')[1], 'base64').toString()).exp;

/**
 * The method for getting the Earthdata Login endpoint URL based on the EDL environment
 *
 * @returns {string} the endpoint URL
 */
const getEdlUrl = (env: string): string => {
  switch (env) {
    case 'PROD':
    case 'OPS':
      return 'https://urs.earthdata.nasa.gov';
    case 'UAT':
      return 'https://uat.urs.earthdata.nasa.gov';
    case 'SIT':
    default:
      return 'https://sit.urs.earthdata.nasa.gov';
  }
};

/**
 * This helper method is called in the functions that retrieve, create, and revoke EarthdataLogin
 * tokens for error-handling. If API call made to the EarthdataLogin endpoint results in an error.
 * The statuscode, statusmessage, error description, and error message are thrown and outputted.
 *
 * @returns {Error} - EarthdataLogin error
 */
export const parseHttpError = (error: HTTPError, requestType: string): Error => {
  const statusCode = error.response.statusCode;
  const statusMessage = error.response.statusMessage || 'Unknown';
  const errorBody = requestType === 'retrieve' || requestType === 'create' ? JSON.stringify(error.response.body) : error.response.body;
  const message = `EarthdataLogin error: ${errorBody},  statusCode: ${statusCode}, statusMessage: ${statusMessage}. Earthdata Login Request failed`;
  return new Error(message);
};

/**
 * The method for getting the token from the Earthdata Login endpoint. Sends a GET request
 * with the users' base64 encoded username and password as a header for authorization. If the
 * users' credentials are accepted the first unexpired token is retrieved, if one exists, and
 * returned on their behalf, if not, an error is thrown. If the user does not have a token
 * in Earthdata Login then undefined is returned to indicate to token needs to be created.
 *
 */
export const retrieveEDLToken = async (
  username: string,
  password: string,
  edlEnv: string
): Promise<string | undefined> => {
  // response: get a token from the Earthdata login endpoint using credentials if exists
  let rawResponse: Response<unknown>;
  try {
    rawResponse = await got.get(`${getEdlUrl(edlEnv)}/api/users/tokens`,
      {
        responseType: 'json',
        username,
        password,
      });
  } catch (error) {
    if (error instanceof got.HTTPError) throw parseHttpError(error, 'retrieve');
    throw parseCaughtError(error);
  }
  const tokens = GetTokenResponseBody.parse(rawResponse.body);
  const isTokenExpired = (token: Token) => (returnJWTexp(token.access_token) < Date.now() / 1000);
  const unExpiredTokens = tokens.filter((token: Token) =>
    token.access_token !== undefined && !isTokenExpired(token));
  const sortedTokens = unExpiredTokens.sort((a, b) =>
    returnJWTexp(a.access_token) - returnJWTexp(b.access_token));
  return sortedTokens.length > 0 ? sortedTokens[sortedTokens.length - 1].access_token : undefined;
};

/**
 * The method for creating Earthdata Login token. This method sends a POST request
 * to the Earthdata Login endpoint URL in order to create a token for the user. The users'
 * username and password are sent as base64 encoded credentials as a header for
 * authorization. If the users' credentials are accepted a token is created on their
 * behalf and returned, if not, an error is thrown.
 *
 */
export const createEDLToken = async (
  username: string,
  password: string,
  edlEnv: string
): Promise<string | undefined> => {
  let rawResponse: Response<unknown>;
  try {
    rawResponse = await got.post(`${getEdlUrl(edlEnv)}/api/users/token`,
      {
        responseType: 'json',
        username,
        password,
      });
  } catch (error) {
    if (error instanceof got.HTTPError) throw parseHttpError(error, 'create');
    throw parseCaughtError(error);
  }
  const response = PostTokenResponseBody.parse([rawResponse.body]);
  return response.length > 0 ? response[0].access_token : undefined;
};

/**
 * This method is used for the cmrTokenSpec integration test in order to revoke the
 * token that is created for testing.
 *
 */
export const revokeEDLToken = async (
  username: string,
  password: string,
  edlEnv: string,
  token: string
): Promise<void> => {
  try {
    await got.post(`${getEdlUrl(edlEnv)}/api/users/revoke_token`,
      {
        searchParams: {
          token,
        },
        username,
        password,
      });
  } catch (error) {
    if (error instanceof got.HTTPError) throw parseHttpError(error, 'revoke');
    throw parseCaughtError(error);
  }
};

/**
 * The method that determines if a user has a token, to call the retrieveEDLToken function
 * which makes an API call to the Earthdata Login endpoint, or to create the token with the
 * createEDLToken function. Returns the token as a string.
 *
 */
export const getEDLToken = async (
  username: string,
  password: string,
  edlEnv: string
): Promise<string | undefined> => {
  let token = await retrieveEDLToken(username, password, edlEnv);
  if (token === undefined) {
    token = await createEDLToken(username, password, edlEnv);
  }
  return token;
};
