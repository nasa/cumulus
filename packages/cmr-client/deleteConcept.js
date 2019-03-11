'use strict';

const Logger = require('@cumulus/logger');
const got = require('got');
const { parseXMLString } = require('./Utils');

const getUrl = require('./getUrl');

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
async function deleteConcept(type, identifier, provider, headers) {
  const url = `${getUrl('ingest', provider)}${type}/${identifier}`;
  log.info(`deleteConcept ${url}`);

  let result;
  try {
    result = await got.delete(url, {
      headers
    });
  }
  catch (error) {
    result = error.response;
  }
  const xmlObject = await parseXMLString(result.body);

  let errorMessage;
  if (result.statusCode !== 200) {
    errorMessage = `Failed to delete, statusCode: ${result.statusCode}, statusMessage: ${result.statusMessage}`;
    if (xmlObject.errors) {
      errorMessage = `${errorMessage}, CMR error message: ${JSON.stringify(xmlObject.errors.error)}`;
    }
    log.info(errorMessage);
  }

  if (result.statusCode !== 200 && result.statusCode !== 404) {
    throw new Error(errorMessage);
  }

  return xmlObject;
}

module.exports = deleteConcept;
