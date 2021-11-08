const template = require('lodash/template');
const { inTestMode } = require('@cumulus/common/test-utils');
const instructions = inTestMode() ? `<a href="${process.env.DISTRIBUTION_ENDPOINT}s3credentials" target="_blank">${process.env.DISTRIBUTION_ENDPOINT}s3credentials</a>` : require('./instructions/index.html');

/**
 * Sends a sample webpage describing how to use s3Credentials endpoint
 *
 * @param {Object} _req - express request object (unused)
 * @param {Object} res - express response object
 * @returns {Object} express response object of the s3Credentials directions.
 */
function displayS3CredentialInstructions(_req, res) {
  const compiled = template(instructions);
  return res.send(compiled(process.env));
}

module.exports = displayS3CredentialInstructions;
