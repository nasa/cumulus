'use strict';

const { CMR, getUrl } = require('@cumulus/cmrjs');
const { DefaultProvider } = require('./crypto');
const log = require('@cumulus/common/log');

/**
 * function for posting cmr xml files from S3 to CMR
 *
 * @param {Object} cmrFile - an object representing the cmr file
 * @param {string} cmrFile.granuleId - the granuleId of the cmr xml File
 * @param {string} cmrFile.filename - the s3 uri to the cmr xml file
 * @param {string} cmrFile.metadata - granule xml document
 * @param {Object} creds - credentials needed to post to the CMR
 * @param {string} creds.provider - the name of the Provider used on the CMR side
 * @param {string} creds.clientId - the clientId used to generate CMR token
 * @param {string} creds.username - the CMR username
 * @param {string} creds.password - the encrypted CMR password
 * @param {string} bucket - the bucket name where public/private keys are stored
 * @param {string} stack - the deployment stack name
 * @returns {Object} CMR's success response which includes the concept-id
 */
async function publish(cmrFile, creds, bucket, stack) {
  let password;
  try {
    password = await DefaultProvider.decrypt(creds.password, undefined, bucket, stack);
  }
  catch (e) {
    log.error('Decrypting password failed, using unencrypted password', e);
    password = creds.password;
  }
  const cmr = new CMR(
    creds.provider,
    creds.clientId,
    creds.username,
    password
  );

  const xml = cmrFile.metadata;
  const res = await cmr.ingestGranule(xml);
  const conceptId = res.result['concept-id'];

  log.info(`Published ${cmrFile.granuleId} to the CMR. conceptId: ${conceptId}`);

  return {
    granuleId: cmrFile.granuleId,
    filename: cmrFile.filename,
    conceptId,
    link: `${getUrl('search')}granules.json?concept_id=${res.result['concept-id']}`
  };
}

module.exports.publish = publish;
