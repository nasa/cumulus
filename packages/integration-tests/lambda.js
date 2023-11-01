'use strict';

const { lambda } = require('@cumulus/aws-client/services');

/**
 * Retrieve a rule's Kinesis Event Source Mappings
 *
 * @param {string} uuid - unique identifier for a rule
 * @returns {Promise<unknown>} - details about an Event Source Mapping
 */
async function getEventSourceMapping(uuid) {
  return await lambda().getEventSourceMapping({ UUID: uuid });
}

/**
 * Delete a rule's Kinesis Event Source Mappings
 *
 * @param {string} uuid - unique identifier for a rule
 * @returns {Promise<unknown>}
 */
async function deleteEventSourceMapping(uuid) {
  return await lambda().deleteEventSourceMapping({ UUID: uuid });
}

module.exports = {
  getEventSourceMapping,
  deleteEventSourceMapping,
};
