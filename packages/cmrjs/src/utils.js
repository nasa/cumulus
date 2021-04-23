const { ValidationError } = require('@cumulus/errors');

// validate is not part of the public cmr-client API
const { validate } = require('@cumulus/cmr-client/ingestConcept');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false,
};

/**
 * Transform UMM version number to metadata format string.
 *
 * @param {string} versionNumber - UMM version string in decimal format (e.g. 1.4)
 * @param {string} [ummFormat='json'] - [optional] UMM format, defaults to 'json'
 * @returns {string} UMM-G metadata format string (e.g. umm_json_v1_4)
 */
function ummVersionToMetadataFormat(versionNumber, ummFormat = 'json') {
  return `umm_${ummFormat}_v${versionNumber.replace('.', '_')}`;
}

module.exports = {
  ValidationError,
  ummVersionToMetadataFormat,
  validate,
  xmlParseOptions,
};
