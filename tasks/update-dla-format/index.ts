
import { runCumulusTask } from '@cumulus/cumulus-message-adapter-js';
import { hoistCumulusMessageDetails } from '@cumulus/message/DeadLetterMessage';
import { CumulusMessage } from '@cumulus/types/message';
import {
  getJsonS3Object,
  putJsonS3Object,
  createS3Buckets,

} from '@cumulus/aws-client/S3';

const updateDLAFile = async (bucket: string, path: string) => {
  const newBucket = bucket + 'new_dla';
  const dlaObject = getJsonS3Object(bucket, path);

  const hoisted = hoistCumulusMessageDetails(dlaObject);
  return putJsonS3Object(newBucket, path, hoisted);
};

const updateDLA = async (event: CumulusMessage) => {
  const { bucket, path } = event;
  await updateDLAFile(bucket, path);
};

const handler = (event: CumulusMessage, context: Object) => runCumulusTask(
  updateDLA,
  event,
  context
);

module.exports = {
  handler,
  updateCmrAccessConstraints,
};
