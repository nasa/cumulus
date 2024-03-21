'use strict';

//@ts-check

import get from 'lodash/get';
import { getDLARootKey } from '@cumulus/message/DeadLetterMessage';
import { updateDLABatch } from './main';

interface UpdateDLAHandlerEvent {
  internalBucket?: string
  stackName?: string
};

async function handler(event: UpdateDLAHandlerEvent) {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');

  const internalBucket = process.env.system_bucket;
  const stackName = process.env.stackName;

  const prefix = get(event, 'prefix', getDLARootKey(stackName));
  const targetPath = get(event, 'targetPath', getDLARootKey(stackName).replace('dead-letter-archive', 'updated-dead-letter-archive'));
  const skip = true;
  updateDLABatch(internalBucket, targetPath, prefix, skip);
}

module.exports = {
  handler,
};
