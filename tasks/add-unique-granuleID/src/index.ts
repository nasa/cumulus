import Logger from '@cumulus/logger';
import { Context } from 'aws-lambda';

import { constructCollectionId } from '@cumulus/message/Collections';
import { generateUniqueGranuleId } from '@cumulus/ingest/granule';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { CumulusMessageWithAssignedPayload, runCumulusTask } from '@cumulus/cumulus-message-adapter-js';

import { HandlerEvent, GranuleOutput, HandlerOutput } from './types';

const log = new Logger({ sender: '@cumulus/add-unique-granule-id' });

/**
 * If no producerGranuleId is assigned,
 * assign uniqueIds to the granules in the payload,
 * preserving the original ID in 'producerGranuleId'.
 *
 * @param event - input from the message adapter
 * @returns - updated granules
 */
async function assignUniqueIds(event: HandlerEvent): Promise<HandlerOutput> {
  let { granules } = event.input;
  const includeTimestampHashKey = event?.config?.includeTimestampHashKey ?? false;
  if (!includeTimestampHashKey) {
    // remove duplicate granules
    granules = Array.from(new Map(granules.map((obj) => [`${obj.granuleId}|${obj.collectionId}`, obj])).values());
  }
  for (const granule of granules) {
    if (!granule.producerGranuleId) {
      const collectionId = granule.collectionId
        || constructCollectionId(granule.dataType, granule.version);
      const newGranuleId = generateUniqueGranuleId(
        granule.granuleId,
        collectionId,
        Number(event?.config?.hashLength) || 8,
        includeTimestampHashKey
      );
      granule.producerGranuleId = granule.granuleId;
      granule.granuleId = newGranuleId;
    }
  }
  const output = { granules: granules as GranuleOutput[] };
  log.debug('Granule output', output);
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
