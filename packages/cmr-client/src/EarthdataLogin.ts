import { z } from 'zod';
import got, { Got, HTTPError } from 'got';
import { sortBy } from 'lodash';

const TokenSchema = z.object({
  access_token: z.string(),
  expiration_date: z.string(),
});

type Token = z.infer<typeof TokenSchema>;

const GetTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expiration_date: z.string(),
});

type GetToken = z.infer<typeof GetTokenSchema>;

const GetTokenResponseBody = z.array(GetTokenSchema);
const PostTokenResponseBody = z.array(TokenSchema);

const parseCaughtError = (e: unknown): Error => (e instanceof Error ? e : new Error(`${e}`));

/**
* The method for getting the Earthdata Login endpoint URL based on the EDL environment
*
* @returns {<string>} the endpoint URL
*/
const getEDLurl = (env:string) =>  {
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
}

const parseHttpError = (error: HTTPError): Error => {
  const statusCode = error.response.statusCode;
  const statusMessage = error.response.statusMessage || 'Unknown';
  const message = `EarthdataLogin error: ${error.response.body},  statusCode: ${statusCode}, statusMessage: ${statusMessage}. Earthdata Login Request failed`;
  return new Error(message);
};

export interface EarthdataLoginParams {
  username: string,
  password: string,
  edlEnv: string,
}

/**
 * A class to simplify requests for the Earthdata Login token used for CMR
 *
 * @typicalname earthdataLogin
 *
 * @example
 * const { EarthdataLogin } = require('@cumulus/cmr-client');
 *
 * const earthdataLogin = new EarthdataLogin({
 *  "username": "my-username",
 *  "password": "my-password",
 *  "edlEnv": "my-edl-environment"
 * });
 */
export class EarthdataLogin {
  username: string;
  password: string;
  edlEnv: string;

  private edlClient: Got;

  /**
  * The constructor for the EarthdataLogin class
  *
  * @param {string} params.username - Earthdata Login username, required parameter
  * @param {string} params.password - Earthdata Login password, required parameter
  * @param {string} params.edlEnv - the Earthdata Login environment (['PROD', 'OPS', 'SIT', 'UAT'])
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

    const edlUrl = getEDLurl(this.edlEnv);
    this.edlClient = got.extend({ prefixUrl: edlUrl });
  }

  /**
   * The method that determines if a user has a token, to call the retrieveEDLToken function
   * which makes an API call to the Earthdata Login endpoint, or to create the token with the
   * createEDLToken function. Returns the token as a string.
   *
   * @returns {Promise.<string>} the token
   */
  async getEDLToken(): Promise<string> {
    let token = await this.retrieveEDLToken();
    if (token === undefined) {
      token = await this.createEDLToken();
    }
    return token;
  }

  /**
   * This helper method is called in the functions that retrieve, create, and revoke EarthdataLogin
   * tokens for error-handling. If API call made to the EarthdataLogin endpoint results in an error.
   * The statuscode, statusmessage, error description, and error message are thrown and outputted.
   *
   * @throws {Error} - EarthdataLogin error
   */

  /**
   * The method for getting the token from the Earthdata Login endpoint. Sends a GET request
   * with the users' base64 encoded username and password as a header for authorization. If the
   * users' credentials are accepted the first unexpired token is retrieved, if one exists, and
   * returned on their behalf, if not, an error is thrown. If the user does not have a token
   * in Earthdata Login then undefined is returned to indicate to token needs to be created.
   *
   * @returns {Promise.<string>} the token
   */
  async retrieveEDLToken(): Promise<string> {
    // response: get a token from the Earthdata login endpoint using credentials if exists
    let rawResponse: unknown;
    try {
      rawResponse = await this.edlClient.get<unknown>('/api/users/tokens',
        {
          username: this.username,
          password: this.password
        });
    } catch (error) {
      if (error instanceof got.HTTPError) throw parseHttpError(error);
      throw parseCaughtError(error);
  }
  const tokens = GetTokenResponseBody.parse(rawResponse);
  const currDate = new Date();
  const isTokenExpired = (token: Token) => new Date(token.expiration_date) > new Date();
  const unExpiredTokens = tokens.filter((token) => !isTokenExpired(token));
  const latestToken = sortBy(unExpiredTokens, ['expiration_date'])[0];
  return latestToken.access_token;
  } 

  /**
   * The method for creating Earthdata Login token. This method sends a POST request
   * to the Earthdata Login endpoint URL in order to create a token for the user. The users'
   * username and password are sent as base64 encoded credentials as a header for
   * authorization. If the users' credentials are accepted a token is created on their
   * behalf and returned, if not, an error is thrown.
   *
   * @returns {Promise.<string>} the token
   */
   async createEDLToken(): Promise<string> {
    let rawResponse: unknown;
    try {
      rawResponse = await this.edlClient.post<unknown>('/api/users/token',
        {
          username: this.username,
          password: this.password
        });
    } catch (error) {
      if (error instanceof got.HTTPError) throw parseHttpError(error);
      throw parseCaughtError(error);
    }
    const response = PostTokenResponseBody.parse(rawResponse);
    return response[0].access_token;
  }

  /**
   * This method is used for the cmrTokenSpec integration test in order to revoke the
   * token that is created for testing.
   *
   */
   async revokeEDLToken(token: string): Promise<void> {
    try {
      await this.edlClient.post('api/users/revoke_token',
        {
          searchParams: {
            token,
          },
          username: this.username,
          password: this.password,
        });
    } catch (error) {
      if (error instanceof got.HTTPError) throw parseHttpError(error);
      throw parseCaughtError(error);
    }
  }
}
