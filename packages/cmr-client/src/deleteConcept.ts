import Logger from '@cumulus/logger';
import got, { Headers } from 'got';
import { parseXMLString } from './Utils';

import getUrl from './getUrl';

const log = new Logger({ sender: 'cmr-client' });

/**
 * Deletes a record from the CMR
 *
 * @param {string} type - the concept type. Choices are: collection, granule
 * @param {string} identifier - the record id
 * @param {string} provider - the CMR provider id
 * @param {Object} headers - the CMR headers
 * @returns {Promise.<Object>} the CMR response object
 */
async function deleteConcept(
  type: string,
  identifier: string,
  provider: string,
  headers: Headers
): Promise<unknown> {
  const url = `${getUrl('ingest', provider)}${type}/${identifier}`;
  log.info(`deleteConcept ${url}`);

  let result;
  try {
    result = await got.delete(url, {
      headers,
    });
  } catch (error) {
    result = error.response;
  }
  const xmlObject = await parseXMLString(result.body);

  let errorMessage;
  if (result.statusCode !== 200) {
    errorMessage = `Failed to delete, statusCode: ${result.statusCode}, statusMessage: ${result.statusMessage}`;
    if ((<{errors: {error: unknown}}>xmlObject).errors) {
      errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify((<{errors: {error: unknown}}>xmlObject).errors.error)}`;
    }
    log.info(errorMessage);
  }

  if (result.statusCode !== 200 && result.statusCode !== 404) {
    throw new Error(errorMessage);
  }

  return xmlObject;
}

export = deleteConcept;
