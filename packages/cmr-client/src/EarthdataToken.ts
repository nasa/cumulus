// @ts-nocheck
import get from 'lodash/get';
import got from 'got';
import Logger from '@cumulus/logger';

import { EarthdataGetTokenResponse, EarthdataPostTokenResponse } from './types';
const log = new Logger({ sender: 'cmr-client' });

const logDetails: { [key: string]: string } = {
  file: 'cmr-client/CMR.js',
};

function formatData(
  username: string,
  password: string
) {
  const credentials = username + ':' + password;
  const buff = Buffer.from(credentials).toString('base64');
  let cmrenv = '';
  if (process.env.CMR_ENVIRONMENT === 'PROD' || process.env.CMR_ENVIRONMENT === 'OPS') {
    cmrenv = '';
  } else if (process.env.CMR_ENVIRONMENT === 'UAT' || process.env.CMR_ENVIRONMENT === 'SIT') {
    cmrenv = process.env.CMR_ENVIRONMENT + '.';
  } else {
    throw new TypeError(`Invalid CMR environment: ${process.env.CMR_ENVIRONMENT}`);
  }
  const returnarray: Array<string> = [buff, cmrenv];
  return returnarray;
}

export async function getEDLToken(
  username: string,
  password: string
): Promise<string> {
  const data = formatData(username, password);
  // response: get a token from the Earthdata login endpoint using credentials if exists
  let response: EarthdataGetTokenResponse;
  try {
    response = await got.get(`https://${data[1]}urs.earthdata.nasa.gov/api/users/tokens`,
      {
        headers: {
          Authorization: `Basic ${data[0]}`,
        },
      }).json();
  } catch (error) {
    logDetails.credentials = username + ':' + password;
    log.error(error, logDetails);
    const statusCode = get(error, 'response.statusCode', error.code);
    const statusMessage = get(error, 'response.statusMessage', error.message);
    let errorMessage = `Authentication error: Invalid Credentials, Authentication with Earthdata Login failed, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;
    const responseError = get(error, 'response.body.errors');
    if (responseError) {
      errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
    }

    log.error(errorMessage);
    throw new Error(errorMessage);
  }
  if (Object.keys(response).length === 0) {
    return '';
  }
  return response[0].access_token;
}

export async function createEDLToken(
  username: string,
  password: string
): Promise<string> {
  const data = formatData(username, password);
  let response: EarthdataPostTokenResponse;
  try {
    response = await got.post(`https://${data[1]}urs.earthdata.nasa.gov/api/users/token`,
      {
        headers: {
          Authorization: `Basic ${data[0]}`,
        },
      }).json();
  } catch (error) {
    logDetails.credentials = username + ':' + password;
    log.error(error, logDetails);
    const statusCode = get(error, 'response.statusCode', error.code);
    const statusMessage = get(error, 'response.statusMessage', error.message);
    let errorMessage = `Authentication error: Invalid Credentials, Authentication with Earthdata Login failed, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;
    const responseError = get(error, 'response.body.errors');
    if (responseError) {
      errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
    }

    log.error(errorMessage);
    throw new Error(errorMessage);
  }
  return response.access_token;
}

export async function revokeEDLToken(
  username: string,
  password: string,
  token: string
): Promise<void> {
  const data = formatData(username, password);
  try {
    /* eslint-disable no-unused-vars */
    const response = await got.post(`https://${data[1]}urs.earthdata.nasa.gov/api/users/revoke_token?token=${token}`,
      {
        headers: {
          Authorization: `Basic ${data[0]}`,
        },
      }).json();
      /* eslint-disable no-unused-vars */
  } catch (error) {
    logDetails.credentials = username + ':' + password;
    log.error(error, logDetails);
    const statusCode = get(error, 'response.statusCode', error.code);
    const statusMessage = get(error, 'response.statusMessage', error.message);
    let errorMessage = `Authentication error: Invalid Credentials, Authentication with Earthdata Login failed, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;
    const responseError = get(error, 'response.body.errors');
    if (responseError) {
      errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
    }

    log.error(errorMessage);
    throw new Error(errorMessage);
  }
}
