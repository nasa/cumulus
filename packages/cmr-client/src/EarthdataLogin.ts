import { z } from 'zod';
import got, { Response, HTTPError } from 'got';
const jwt = require('jsonwebtoken');
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
 * Get the Earthdata Login endpoint URL based on the EDL environment
 *
 * @param {string} env - the environment of the Earthdata Login (ex. 'SIT')
 * @returns {string} - the endpoint URL
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
 * Parse and handle error returned from EDL endpoint
 *
 * @param {HTTPError} error - the HTTP error response returned by the EarthdataLogin endpoint
 * @param {string} requestType - the type of token request (options: 'retrieve', 'create', 'revoke')
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
 * Retrieve an existing valid token
 *
 * @param {string} username - the username of the Earthdata Login user
 * @param {string} password - the password of the Earthdata Login user
 * @param {string} edlEnv - the environment of the Earthdata Login (ex. 'SIT')
 * @returns {Promise <string | undefined>} - the token or undefined if there
 */
export const retrieveEDLToken = async (
  username: string,
  password: string,
  edlEnv: string
): Promise<string | undefined> => {
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
  const isTokenExpired = (token: Token) => (jwt.decode(token.access_token).exp < Date.now() / 1000);
  const unExpiredTokens = tokens.filter((token: Token) =>
    token.access_token !== undefined && !isTokenExpired(token));
  const sortedTokens = unExpiredTokens.sort((a, b) =>
    jwt.decode(a.access_token).exp - jwt.decode(b.access_token).exp);
  return sortedTokens.length > 0 ? sortedTokens[sortedTokens.length - 1].access_token : undefined;
};

/**
 * Create a token.
 *
 * @param {string} username - the username of the Earthdata Login user
 * @param {string} password - the password of the Earthdata Login user
 * @param {string} edlEnv - the environment of the Earthdata Login (ex. 'SIT')
 * @returns {Promise <string | undefined>} - the token or undefined
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
 * Revoke a token
 *
 * @param {string} username - the username of the Earthdata Login user
 * @param {string} password - the password of the Earthdata Login user
 * @param {string} edlEnv - the environment of the Earthdata Login user (ex. 'SIT')
 * @param {string} token - the token to revoke
 * @returns {void}
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
 * Get a token by retrieving an existing token or creating a new one
 *
 * @param {string} username - the username of the Earthdata Login user
 * @param {string} password - the password of the Earthdata Login user
 * @param {string} edlEnv - the environment of the Earthdata Login (ex. 'SIT')
 * @returns {Promise <string | undefined>} - the JSON Web Token string or undefined
 */
<<<<<<< HEAD
export const getEDLToken = async (
  username: string,
  password: string,
  edlEnv: string
): Promise<string | undefined> => {
  let token = await retrieveEDLToken(username, password, edlEnv);
  if (token === undefined) {
    token = await createEDLToken(username, password, edlEnv);
=======
export class EarthdataLogin {
  username: string;
  password: string;
  edlEnv?: string;

  /**
  * The constructor for the EarthdataLogin class
  *
  * @param {string} params.username - Earthdata Login username, required parameter
  * @param {string} params.password - Earthdata Login password, required parameter
  * @param {string | undefined} params.edlEnv
  *   - the Earthdata Login environment (['PROD', 'OPS', 'SIT', 'UAT']),
  *   - optional, defaults to 'SIT'
  *
  * @example
  *
  * {
  *  "username": "janedoe",
  *  "password": "password",
  *  "edlEnv": "UAT"
  * }
  */

  constructor(params: EarthdataLoginParams) {
    this.username = params.username;
    this.password = params.password;
    this.edlEnv = params.edlEnv;
>>>>>>> feature/rds-phase-3
  }
  return token;
};
