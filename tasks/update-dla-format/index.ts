
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { hoistCumulusMessageDetails } from 'write-db-dlq-records-to-s3';

const updateDLAFile = async (dlaFile) => {
  const 
}

const updateDLA = async (event) => {
  const { config, input } = event;
  const { etags = {}, accessConstraints } = config;
  const updatedDLAObjects = await Promise.all(
    s3FileObjects.map(updateDLAFiles)
  )
}
const handler = (event, context) => runCumulusTask(
  updateCmrAccessConstraints,
  event,
  context
);

module.exports = {
  handler,
  updateCmrAccessConstraints,
};
