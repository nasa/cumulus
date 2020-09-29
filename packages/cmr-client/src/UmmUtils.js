'use strict';

const get = require('lodash/get');
const got = require('got');
const getUrl = require('./getUrl');
const ValidationError = require('./ValidationError');

/**
 * Find the UMM version as a decimal string.
 * If a version cannot be found on the input object
 * version 1.4 is assumed and returned.
 *
 * @param {Object} umm - UMM metadata object
 * @returns {string} UMM version for the given object
 */
const ummVersion = (umm) => get(umm, 'MetadataSpecification.Version', '1.4');

/**
 * Posts a given XML string to the validate endpoint of CMR and throws an
 * exception if it is not valid
 *
 * @param {string} ummMetadata - the UMM object
 * @param {string} identifier - the document identifier
 * @param {string} provider - the CMR provider
 * @returns {Promise<undefined>}
 */
const validateUMMG = async (ummMetadata, identifier, provider) => {
  const version = ummVersion(ummMetadata);

  const { statusCode, body } = await got.post(
    `${getUrl('validate', provider)}granule/${identifier}`,
    {
      json: ummMetadata,
      responseType: 'json',
      headers: {
        Accept: 'application/json',
        'Content-type': `application/vnd.nasa.cmr.umm+json;version=${version}`,
      },
      throwHttpErrors: false,
    }
  );

  if (statusCode === 200) return;

  throw new ValidationError(`Validation was not successful, CMR error message: ${JSON.stringify(body.errors)}`);
};

module.exports = {
  ummVersion,
  validateUMMG,
};
