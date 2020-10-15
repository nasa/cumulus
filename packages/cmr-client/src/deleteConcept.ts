import Logger from '@cumulus/logger';
import got, { Headers } from 'got';
import { parseXMLString } from './Utils';

import { getIngestUrl } from './getUrl';
import { CMRResponseBody, CMRErrorResponseBody, ConceptType } from './types';

const log = new Logger({ sender: 'cmr-client' });

/**
 * Deletes a record from the CMR
 *
 * @param {string} type - the concept type. Choices are: collections, granules
 * @param {string} identifier - the record id
 * @param {string} provider - the CMR provider id
 * @param {Object} headers - the CMR headers
 * @returns {Promise.<Object>} the CMR response object
 */
async function deleteConcept(
  type: ConceptType,
  identifier: string,
  provider: string,
  headers?: Headers
): Promise<CMRResponseBody|CMRErrorResponseBody> {
  const url = `${getIngestUrl({ provider })}${type}/${identifier}`;

  log.info(`deleteConcept ${url}`);

  try {
    const deleteResponse = await got.delete(url, { headers });

    return <CMRResponseBody>(await parseXMLString(deleteResponse.body));
  } catch (error) {
    const parsedResponseBody = <CMRErrorResponseBody>(await parseXMLString(error.response.body));

    if (error.response.statusCode === 404) {
      return parsedResponseBody;
    }

    const { statusCode, statusMessage } = error.response;

    let errorMessage = `Failed to delete, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;

    if (parsedResponseBody.errors) {
      errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(parsedResponseBody.errors.error)}`;
    }

    log.info(errorMessage);

    throw new Error(errorMessage);
  }
}

export = deleteConcept;
