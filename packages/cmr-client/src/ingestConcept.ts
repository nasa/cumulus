import get from 'lodash/get';
import got, { Headers } from 'got';
import property from 'lodash/property';
import { CMRInternalError } from '@cumulus/errors';
import Logger from '@cumulus/logger';

import { getIngestUrl } from './getUrl';
import { parseXMLString } from './Utils';
import { CMRResponseBody, CMRErrorResponseBody, ConceptType } from './types';

const log = new Logger({ sender: 'cmr-client' });

const logDetails: { [key: string]: string } = {
  file: 'cmr-client/ingestConcept.js',
};

/**
 * Posts a record of any kind (collection, granule, etc) to
 * CMR
 *
 * @param {string} type - the concept type. Choices are: collection, granule
 * @param {string} xmlString - the CMR record in xml
 * @param {string} identifierPath - the concept's unique identifier
 * @param {string} provider - the CMR provider id
 * @param {Object} headers - the CMR headers
 * @returns {Promise.<Object>} the CMR response object
 */
async function ingestConcept(
  type: ConceptType,
  xmlString: string,
  identifierPath: string,
  provider: string,
  headers: Headers
): Promise<CMRResponseBody | CMRErrorResponseBody> {
  const xmlObject = await parseXMLString(xmlString);

  const identifier = <string>property(identifierPath)(xmlObject);
  logDetails.granuleId = identifier;

  try {
    const response = await got.put(
      `${getIngestUrl({ provider })}${type}s/${identifier}`,
      {
        body: xmlString,
        headers,
      }
    );

    return <CMRResponseBody>(await parseXMLString(response.body));
  } catch (error) {
    log.error(error, logDetails);

    const statusCode = get(error, 'response.statusCode', error.code);
    const statusMessage = get(error, 'response.statusMessage', error.message);
    let errorMessage = `Failed to ingest, statusCode: ${statusCode}, statusMessage: ${statusMessage}`;

    if (get(error, 'response.body')) {
      const parsedResponseBody = <CMRErrorResponseBody>(await parseXMLString(error.response.body));
      const responseError = get(parsedResponseBody, 'errors.error');
      if (responseError) {
        errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(responseError)}`;
      }
    }

    log.error(errorMessage);

    if (statusCode >= 500 && statusCode < 600) {
      throw new CMRInternalError(errorMessage);
    }
    throw new Error(errorMessage);
  }
}
export = ingestConcept;
