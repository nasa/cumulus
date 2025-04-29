import Logger from '@cumulus/logger';
import { Context } from 'aws-lambda';

import { generateUniqueGranuleId } from '@cumulus/ingest/granule';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { CumulusMessageWithAssignedPayload, runCumulusTask } from '@cumulus/cumulus-message-adapter-js';

import { HandlerEvent, HandlerOutput } from './types';

const log = new Logger({ sender: '@cumulus/add-unique-granule-id' });

/**
 * If no producerId is assigned,
 * assign uniqueIds to the granules in the payload,
 * preserving the original ID in 'producerGranuleId'.
 *
 * @param event - input from the message adapter
 * @returns the uri of the pan
 */
async function assignUniqueIds(event: HandlerEvent): Promise<HandlerOutput> {
  const { granules } = event.input;

  const output = {
    granules: granules.map((granule) => {
      const granuleId = granule.producerGranuleId ? granule.granuleId
        : generateUniqueGranuleId(granule, Number(event?.config?.hashDepth || 8));
      return {
        producerGranuleId: granule.producerGranuleId ?? granule.granuleId,
        ...granule,
        granuleId,
      };
    }),
  };
  log.debug(':', output);
  return output;
}

/**
 * Lambda handler
 *
 * @param event      - a Cumulus Message
 * @param context    - an AWS Lambda context
 * @returns  -
 *   Returns output from task.
 *   See schemas/output.json for detailed output schema
 */
export const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessageWithAssignedPayload
| CumulusRemoteMessage> => await runCumulusTask(assignUniqueIds, event, context);

exports.handler = handler;
exports.assignUniqueIds = assignUniqueIds;
