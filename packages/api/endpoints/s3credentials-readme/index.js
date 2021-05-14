const template = require('lodash/template');
// eslint-disable-next-line max-len
// eslint-disable-next-line import/no-webpack-loader-syntax,import/no-unresolved,node/no-extraneous-require
const instructions = require('html-loader!./instructions/index.html');

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
