const template = require('lodash/template');
const instructions = require('./instructions/index.html');

/**
 * Sends a sample webpage describing how to use s3Credentials endpoint
 *
 * @param {Object} _req - express request object (unused)
 * @param {Object} res - express response object
 * @returns {Object} express repose object of the s3Credentials directions.
 */
async function displayS3CredentialInstructions(_req, res) {
  const compiled = template(instructions);
  res.send(compiled(process.env));
}

module.exports = displayS3CredentialInstructions;
