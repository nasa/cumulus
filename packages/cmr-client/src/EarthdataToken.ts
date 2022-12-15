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

export interface EarthdataTokenParams {
  username: string,
  password: string,
  edlEnv: string,
  token?: string,
}

/**
 * A class to simplify requests for the Earthdata Login token used for CMR
 *
 * @typicalname earthdataToken
 *
 * @example
 * const { EarthdataToken } = require('@cumulus/cmr-client');
 *
 * const earthdataToken = new EarthdataToken({
 *  "username": "my-username",
 *  "password": "my-password",
 *  "edlEnv": "my-cmr-environment",
 *  "token" : "my-token"
 * });
 */
export class EarthdataToken {
  username: string;
  password: string;
  edlEnv: string;
  token?: string;

  /**
  * The constructor for the EarthdataToken class
  *
  * @param {string} params.username - Earthdata username
  * @param {string} params.password - Earthdata password
  * @param {string} params.edlEnv - the CMR environment of the user
  * @param {string} params.token- the EarthdataLogin token, undefined if user doesn't have one
  *
  * @example
  *
  * {
  *  "username": "janedoe",
  *  "password": "password",
  *  "edlEnv": "UAT",
  *  "token" : "1782hg134bsd71"
  *
  * }
  */

  constructor(params: EarthdataTokenParams) {
    this.username = params.username;
    this.password = params.password;
    this.edlEnv = params.edlEnv;
    this.token = params.token;
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
        return 'https://sit.urs.earthdata.nasa.gov';
      default:
        return 'https://sit.urs.earthdata.nasa.gov';
    }
  }

  async getEDLToken(): Promise<string> {
    if (!this.token) {
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
        return date1 >= date2 ? 'Bearer' + response[1].access_token : 'Bearer' + response[0].access_token;
      }
      return 'Bearer ' + response[0].access_token;
    }
    return 'Bearer ' + this.token;
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
    this.token = response.access_token;
    return 'Bearer ' + response.access_token;
  }

  async revokeEDLToken(
    token: string
  ): Promise<void> {
    const buff = Buffer.from(`${this.username + ':' + this.password}`).toString('base64');
    const url = this.getEDLurl();
    const newtoken = token.toString().replace('Bearer: ', '');
    try {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const response = await got.post(`${url}/api/users/revoke_token?token=${newtoken}`,
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
    if (this.token === newtoken) {
      this.token = undefined;
    }
  }
}
