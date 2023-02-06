import * as z from 'zod';
import got, { /*Got,*/ HTTPError } from 'got';
import { sortBy } from 'lodash';
// import { getRequiredEnvVar } from '../../common/env';

const TokenSchema = z.object({
  access_token: z.string(),
  expiration_date: z.string(),
});

const PostTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expiration_date: z.string(),
})

type Token = z.infer<typeof TokenSchema>;

const GetTokenResponseBody = z.array(TokenSchema);

//var edlClient: Got;
// type GetToken = z.infer<typeof GetTokenSchema>;
/*const PostTokenResponseBody = z.object({
  access_token: z.string(),
  expiration_date: z.string(),
});*/

const PostTokenResponseBody = z.array(PostTokenSchema);

const parseCaughtError = (e: unknown): Error => (e instanceof Error ? e : new Error(`${e}`));

/**
* The method for getting the Earthdata Login endpoint URL based on the EDL environment
*
* @returns {<string>} the endpoint URL
*/
const getEdlUrl = (env:string) =>  {
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

/**
* This helper method is called in the functions that retrieve, create, and revoke EarthdataLogin
* tokens for error-handling. If API call made to the EarthdataLogin endpoint results in an error.
* The statuscode, statusmessage, error description, and error message are thrown and outputted.
*
* @throws {Error} - EarthdataLogin error
*/
const parseHttpError = (error: HTTPError, requestType: string): Error => {
  const statusCode = error.response.statusCode;
  const statusMessage = error.response.statusMessage || 'Unknown';
  const errorBody = requestType === 'retrieve' ? JSON.stringify(error.response.body) : error.response.body;
  const message = `EarthdataLogin error: ${errorBody},  statusCode: ${statusCode}, statusMessage: ${statusMessage}. Earthdata Login Request failed`;
  return new Error(message);
};

  /**
   * The method that determines if a user has a token, to call the retrieveEDLToken function
   * which makes an API call to the Earthdata Login endpoint, or to create the token with the
   * createEDLToken function. Returns the token as a string.
   *
   * @returns {string} the token
   */
export const getEDLToken = async (username: string, password: string, edlEnv: string): Promise<string> => {
  let token = await retrieveEDLToken(username, password, edlEnv);
  if (token === undefined) {
    token = await createEDLToken(username, password, edlEnv);
  }
  return token;
};

  /**
   * The method for getting the token from the Earthdata Login endpoint. Sends a GET request
   * with the users' base64 encoded username and password as a header for authorization. If the
   * users' credentials are accepted the first unexpired token is retrieved, if one exists, and
   * returned on their behalf, if not, an error is thrown. If the user does not have a token
   * in Earthdata Login then undefined is returned to indicate to token needs to be created.
   *
   * @returns {string} the token
   */
export const retrieveEDLToken = async (username: string, password: string, edlEnv: string): Promise<string | undefined> => {
  // response: get a token from the Earthdata login endpoint using credentials if exists
  let rawResponse: any;
  try {
    rawResponse = await got.get(`${getEdlUrl(edlEnv)}/api/users/tokens`,
      {
        responseType: 'json',
        /*headers: {
          Authorization: `Basic ${buff}`,
        },*/
        username: username,
        password: password,
      });
  } catch (error) {
    if (error instanceof got.HTTPError) throw parseHttpError(error, 'retrieve');
    throw parseCaughtError(error);
  }
const array: { access_token: string; token_type: string; expiration_date: string; }[] = rawResponse.body;
const tokens = GetTokenResponseBody.parse(array);
const isTokenExpired = (token: Token) => new Date(token.expiration_date) < new Date();
const unExpiredTokens = tokens.filter((token: any) => !isTokenExpired(token));
return unExpiredTokens.length > 0 ? sortBy(unExpiredTokens, ['expiration_date'])[0].access_token : undefined;
};

  /**
   * The method for creating Earthdata Login token. This method sends a POST request
   * to the Earthdata Login endpoint URL in order to create a token for the user. The users'
   * username and password are sent as base64 encoded credentials as a header for
   * authorization. If the users' credentials are accepted a token is created on their
   * behalf and returned, if not, an error is thrown.
   *
   * @returns {string} the token
   */
export const createEDLToken = async (username: string, password: string, edlEnv: string): Promise<string> => {
  let rawResponse: any;
  try {
    rawResponse = await got.post(`${getEdlUrl(edlEnv)}/api/users/token`,
      {
        username: username,
        password: password
      });
  } catch (error) {
    if (error instanceof got.HTTPError) throw parseHttpError(error, 'create');
    throw parseCaughtError(error);
  }
  const array: { access_token: string; token_type: string; expiration_date: string; }[] = rawResponse.body;
  console.log("\n", rawResponse.body);
  const response = PostTokenResponseBody.parse(array);
  return response[0].access_token;
}

  /**
   * This method is used for the cmrTokenSpec integration test in order to revoke the
   * token that is created for testing.
   *
   */
export const revokeEDLToken = async (username: string, password: string, edlEnv: string, token: string): Promise<void> => {
  try {
    await got.post(`${getEdlUrl(edlEnv)}/api/users/revoke_token`,
      {
        searchParams: {
          token,
        },
        username: username,
        password: password,
      });
  } catch (error) {
    if (error instanceof got.HTTPError) throw parseHttpError(error, 'revoke');
    throw parseCaughtError(error);
  }
}

/*-------------------------------------------------------------------------------------*/
/*export interface EarthdataLoginParams {
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
/*export class EarthdataLogin {
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

  /*constructor(params: EarthdataLoginParams) {
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
  /*async getEDLToken(): Promise<string> {
    let token = await this.retrieveEDLToken();
    if (token === undefined) {
      token = await this.createEDLToken();
    }
    return token;
  }

  /**
   * The method for getting the token from the Earthdata Login endpoint. Sends a GET request
   * with the users' base64 encoded username and password as a header for authorization. If the
   * users' credentials are accepted the first unexpired token is retrieved, if one exists, and
   * returned on their behalf, if not, an error is thrown. If the user does not have a token
   * in Earthdata Login then undefined is returned to indicate to token needs to be created.
   *
   * @returns {Promise.<string>} the token
   */
  /*async retrieveEDLToken(): Promise<string | undefined>{
    // response: get a token from the Earthdata login endpoint using credentials if exists
    let rawResponse: any;
    // const buff = Buffer.from(`${this.username + ':' + this.password}`).toString('base64');
    try {
      rawResponse = await this.edlClient.get('api/users/tokens',
        {
          responseType: 'json',
          /*headers: {
            Authorization: `Basic ${buff}`,
          },
          username: this.username,
          password: this.password,
        });
    } catch (error) {
      if (error instanceof got.HTTPError) throw parseHttpError(error);
      throw parseCaughtError(error);
    }
  const array: { access_token: string; token_type: string; expiration_date: string; }[] = rawResponse.body;
  const tokens = GetTokenResponseBody.parse(array);
  const isTokenExpired = (token: Token) => new Date(token.expiration_date) < new Date();
  const unExpiredTokens = tokens.filter((token) => !isTokenExpired(token));
  return unExpiredTokens.length > 0 ? sortBy(unExpiredTokens, ['expiration_date'])[0].access_token : undefined;
  }*/

  /**
   * The method for creating Earthdata Login token. This method sends a POST request
   * to the Earthdata Login endpoint URL in order to create a token for the user. The users'
   * username and password are sent as base64 encoded credentials as a header for
   * authorization. If the users' credentials are accepted a token is created on their
   * behalf and returned, if not, an error is thrown.
   *
   * @returns {Promise.<string>} the token
   */
   /*async createEDLToken(): Promise<string> {
    let rawResponse: unknown;
    try {
      rawResponse = await this.edlClient.post('api/users/token',
        {
          username: this.username,
          password: this.password
        });
    } catch (error) {
      if (error instanceof got.HTTPError) throw parseHttpError(error);
      throw parseCaughtError(error);
    }
    const response = PostTokenResponseBody.parse(rawResponse);
    return response.access_token;
  }

  /**
   * This method is used for the cmrTokenSpec integration test in order to revoke the
   * token that is created for testing.
   *
   */
  /*
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
  }*/
