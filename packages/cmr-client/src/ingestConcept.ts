import got, { Headers } from 'got';
import property from 'lodash/property';
import Logger from '@cumulus/logger';

import validate from './validate';
import { getIngestUrl } from './getUrl';
import { parseXMLString } from './Utils';

const log = new Logger({ sender: 'cmr-client' });

const logDetails: {[key: string]: string} = {
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
  type: string,
  xmlString: string,
  identifierPath: string,
  provider: string,
  headers: Headers
) {
  const xmlObject = await parseXMLString(xmlString);

  const identifier = <string>property(identifierPath)(xmlObject);
  logDetails.granuleId = identifier;

  try {
    await validate(type, xmlString, identifier, provider);

    const response = await got.put(
      `${getIngestUrl({ provider })}${type}s/${identifier}`,
      {
        body: xmlString,
        headers,
      }
    );

    const ingestResponseBody = <{errors?: {error: string}}>(await parseXMLString(response.body));

    if (ingestResponseBody.errors) {
      const xmlObjectError = JSON.stringify(ingestResponseBody.errors.error);
      throw new Error(`Failed to ingest, CMR error message: ${xmlObjectError}`);
    }

    return ingestResponseBody;
  } catch (error) {
    log.error(error, logDetails);
    throw error;
  }
}
export = ingestConcept;
