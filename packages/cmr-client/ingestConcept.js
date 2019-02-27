'use strict';

const got = require('got');
const { parseString } = require('xml2js');
const property = require('lodash.property');
const Logger = require('@cumulus/logger');

const validate = require('./validate');
const { getUrl } = require('./getUrl');

const log = new Logger({ sender: 'cmr-client' });

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

const logDetails = {
  file: 'cmr-client/ingestConcept.js'
};

/**
 * Posts a records of any kind (collection, granule, etc) to
 * CMR
 *
 * @param {string} type - the concept type. Choices are: collection, granule
 * @param {string} xmlString - the CMR record in xml
 * @param {string} identifierPath - the concept's unique identifier
 * @param {string} provider - the CMR provider id
 * @param {Object} headers - the CMR headers
 * @returns {Promise.<Object>} the CMR response object
 */
async function ingestConcept(type, xmlString, identifierPath, provider, headers) {
  let xmlObject = await new Promise((resolve, reject) => {
    parseString(xmlString, xmlParseOptions, (err, obj) => {
      if (err) reject(err);
      resolve(obj);
    });
  });

  const identifier = property(identifierPath)(xmlObject);
  logDetails.granuleId = identifier;

  try {
    await validate(type, xmlString, identifier, provider);

    const response = await got.put(
      `${getUrl('ingest', provider)}${type}s/${identifier}`,
      {
        body: xmlString,
        headers
      }
    );

    xmlObject = await new Promise((resolve, reject) => {
      parseString(response.body, xmlParseOptions, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });

    if (xmlObject.errors) {
      const xmlObjectError = JSON.stringify(xmlObject.errors.error);
      throw new Error(`Failed to ingest, CMR error message: ${xmlObjectError}`);
    }

    return xmlObject;
  }
  catch (e) {
    log.error(e, logDetails);
    throw e;
  }
}

module.exports = {
  ingestConcept,
  validate
};
