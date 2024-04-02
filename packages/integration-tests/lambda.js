'use strict';

const { lambda } = require('@cumulus/aws-client/services');
const {
  DeleteEventSourceMappingCommand,
  GetEventSourceMappingCommand,
} = require('@aws-sdk/client-lambda');

/**
 * Retrieve a rule's Kinesis Event Source Mappings
 *
 * @param {string} uuid - unique identifier for a rule
 * @returns {Promise<unknown>} - details about an Event Source Mapping
 */
async function getEventSourceMapping(uuid) {
  return await lambda().send(new GetEventSourceMappingCommand(({ UUID: uuid })));
}

/**
 * Delete a rule's Kinesis Event Source Mappings
 *
 * @param {string} uuid - unique identifier for a rule
 * @returns {Promise<unknown>}
 */
async function deleteEventSourceMapping(uuid) {
  return await lambda().send(new DeleteEventSourceMappingCommand({ UUID: uuid }));
}

module.exports = {
  getEventSourceMapping,
  deleteEventSourceMapping,
};
