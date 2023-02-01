import { z } from 'zod';
import get from 'lodash/get';
import got, { Got, HTTPError } from 'got';
// import Response from 'got';
// import got from 'got';
import { sortBy } from 'lodash';

type EarthdataGetTokenResponse = Response<{
  body: {
    access_token?: string,
    token_type?: string,
    expiration_date?: string
  }
}>;

type EarthdataPostTokenResponse = Response<{
  body: {
    access_token?: string,
    expiration_date?: string
  }
}>;

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
  }

  /**
   * The method for getting the Earthdata Login endpoint URL based on the EDL environment
   *
   * @returns {Promise.<string>} the endpoint URL
   */
  getEDLurl(
  ) {
    switch (this.edlEnv) {
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
  handleHttpError(error: Error) {
    const statusCode = get(error, 'response.statusCode', error.code);
    const statusMessage = get(error, 'response.statusMessage', error.message);
    const responseErrorDescription = JSON.parse(get(error, 'response.body')).error_description;
    const errorMessage = `EarthdataLogin error: ${responseErrorDescription},  statusCode: ${statusCode}, statusMessage: ${statusMessage}. Earthdata Login Request failed`;

    throw new Error(errorMessage);
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
  async retrieveEDLToken(): Promise<string> {
    const buff = Buffer.from(`${this.username + ':' + this.password}`).toString('base64');
    const url = this.getEDLurl();
    // response: get a token from the Earthdata login endpoint using credentials if exists
    let response: EarthdataGetTokenResponse;
    try {
      response = await got.get(`${url}/api/users/tokens`,
        {
          headers: {
            Authorization: `Basic ${buff}`,
          },
        }).json();
    } catch (error) {
      this.handleHttpError(error);
    }
    const currDate = new Date();

    for (let i = 0; i < Object.keys(response).length; i += 1) {
      const responseDate = new Date(response[i].expiration_date);
      if (currDate < responseDate) {
        return response[i].access_token;
      }
    }
    return undefined!;
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
    const buff = Buffer.from(`${this.username + ':' + this.password}`).toString('base64');
    const url = this.getEDLurl();
    let response: EarthdataPostTokenResponse;
    try {
      response = await got.post(`${url}/api/users/token`,
        {
          headers: {
            Authorization: `Basic ${buff}`,
          },
        }).json();
    } catch (error) {
      this.handleHttpError(error);
    }
    return response[0].access_token;
  }

  /**
   * This method is used for the cmrTokenSpec integration test in order to revoke the
   * token that is created for testing.
   *
   */
  async revokeEDLToken(
    token: string
  ): Promise<void> {
    const buff = Buffer.from(`${this.username + ':' + this.password}`).toString('base64');
    const url = this.getEDLurl();
    try {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const response = await got.post(`${url}/api/users/revoke_token?token=${token}`,
        {
          headers: {
            Authorization: `Basic ${buff}`,
          },
        }).json();
      /* eslint-enable @typescript-eslint/no-unused-vars */
    } catch (error) {
      this.handleHttpError(error);
    }
  }
}
