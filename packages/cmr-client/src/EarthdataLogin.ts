// @ts-nocheck
import get from 'lodash/get';
import got from 'got';
import Response from 'got';

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
 *  "edlEnv": "my-cmr-environment"
 * });
 */
export class EarthdataLogin {
  username: string;
  password: string;
  edlEnv: string;

  /**
  * The constructor for the EarthdataLogin class
  *
  * @param {string} params.username - Earthdata Login username, needed in order to retrieve token
  * @param {string} params.password - Earthdata Login password, needed in order to retrieve token
  * @param {string} params.edlEnv - the CMR environment of the user
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

  async getEDLToken(): Promise<string> {
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
      const statusCode = get(error, 'response.statusCode', error.code);
      const statusMessage = get(error, 'response.statusMessage', error.message);
      let errorMessage = `Authentication error: Invalid Credentials, Authentication with Earthdata Login failed, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;
      const responseError = get(error, 'response.body.errors');
      if (responseError) {
        errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
      }

      throw new Error(errorMessage);
    }
    if (Object.keys(response).length === 0) {
      return this.createEDLToken();
    }
    if (Object.keys(response).length === 2) {
      const date1 = new Date(response[0].expiration_date);
      const date2 = new Date(response[1].expiration_date);
      const date3 = new Date();
      if (date1 > date3) {
        this.revokeEDLToken(response[0].access_token);
      }
      if (date2 > date3) {
        this.revokeEDLToken(response[1].access_token);
      }
      if (date1 > date3 && date2 > date3) {
        this.createEDLToken();
      }
      return date1 >= date2 ? response[1].access_token : response[0].access_token;
    }
    return response[0].access_token;
  }

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
      const statusCode = get(error, 'response.statusCode', error.code);
      const statusMessage = get(error, 'response.statusMessage', error.message);
      let errorMessage = `Authentication error: Invalid Credentials, Authentication with Earthdata Login failed, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;
      const responseError = get(error, 'response.body.errors');
      if (responseError) {
        errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
      }

      throw new Error(errorMessage);
    }
    return response.access_token;
  }

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
      const statusCode = get(error, 'response.statusCode', error.code);
      const statusMessage = get(error, 'response.statusMessage', error.message);
      let errorMessage = `Authentication error: Invalid Credentials, Authentication with Earthdata Login failed, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;
      const responseError = get(error, 'response.body.errors');
      if (responseError) {
        errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
      }

      throw new Error(errorMessage);
    }
  }
}
