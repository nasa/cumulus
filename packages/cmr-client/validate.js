'use strict';

const got = require('got');
const xml2js = require('xml2js');
const ValidationError = require('./ValidationError');
const getUrl = require('./getUrl');
const { promisify } = require('./Utils');

const parseString = promisify(xml2js.parseString);

// TODO Remove this duplication
const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

/**
 * Posts a given xml string to the validate endpoint of the CMR
 * and returns the results
 *
 * @param {string} type - service type
 * @param {string} xml - the xml document
 * @param {string} identifier - the document identifier
 * @param {string} provider - the CMR provider
 * @returns {Promise.<boolean>} returns true if the document is valid
 */
async function validate(type, xml, identifier, provider) {
  let result;
  try {
    result = await got.post(`${getUrl('validate', provider)}${type}/${identifier}`, {
      body: xml,
      headers: {
        'Content-type': 'application/echo10+xml'
      }
    });

    if (result.statusCode === 200) {
      return true;
    }
  }
  catch (e) {
    result = e.response;
  }

  const parsed = await parseString(result.body, xmlParseOptions);

  throw new ValidationError(
    `Validation was not successful, CMR error message: ${JSON.stringify(parsed.errors.error)}`
  );
}

module.exports = validate;
