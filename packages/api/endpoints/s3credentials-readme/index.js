const template = require('lodash/template');
const { promisify } = require('util');
const fs = require('fs');
const readFile = promisify(fs.readFile);
const { join: pathjoin } = require('path');

/**
 * Sends a sample webpage describing how to use s3Credentials endpoint
 *
 * @param {Object} _req - express request object (unused)
 * @param {Object} res - express response object
 * @returns {Object} express repose object of the s3Credentials directions.
 */
async function displayS3CredentialInstructions(_req, res) {
  const instructionTemplate = await readFile(pathjoin(process.cwd(), 'instructions', 'index.html'), 'utf-8');
  const compiled = template(instructionTemplate);
  res.send(compiled(process.env));
}

module.exports = displayS3CredentialInstructions;
