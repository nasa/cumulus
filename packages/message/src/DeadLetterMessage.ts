//@ts-check
import { SQSRecord } from 'aws-lambda';

import { parseSQSMessageBody } from '@cumulus/aws-client/SQS';
import { CumulusMessage } from '@cumulus/types/message';
import { isEventBridgeEvent, StepFunctionEventBridgeEvent } from '@cumulus/common/lambda';
import Logger from '@cumulus/logger';

import { getCumulusMessageFromExecutionEvent } from './StepFunctions';

const log = new Logger({ sender: '@cumulus/DeadLetterMessage' });
interface DLARecord extends SQSRecord {
  error: string
}
export type { DLARecord };

type UnwrapDeadLetterCumulusMessageInputType = (
  StepFunctionEventBridgeEvent
  | DLARecord
  | CumulusMessage
);

/**
 * Bare check for CumulusMessage Shape
 *
 * @param {{ [key: string]: any }} message
 * @returns {message is CumulusMessage}
 */
const isCumulusMessageLike = (message: Object): message is CumulusMessage => (
  message instanceof Object
  && 'cumulus_meta' in message
);

/**
 * Bare check for SQS message Shape
 *
 * @param {{ [key: string]: any }} message
 * @returns {message is DLARecord}
 */
const isSQSRecordLike = (message: Object): message is DLARecord => (
  message instanceof Object
  && ('body' in message || 'Body' in message)
);

/**
 * Unwrap dead letter Cumulus message, which may be wrapped in a
 * States cloudwatch event, which is wrapped in an SQS message.
 *
 * @param {Object} messageBody - received SQS message
 * @returns {Object} the cumulus message or nearest available object
 */
export const unwrapDeadLetterCumulusMessage = async (
  messageBody: UnwrapDeadLetterCumulusMessageInputType
): Promise<UnwrapDeadLetterCumulusMessageInputType> => {
  try {
    if (isSQSRecordLike(messageBody)) {
      // AWS.SQS.Message/SQS.Record case
      const unwrappedMessageBody = parseSQSMessageBody(
        messageBody
      );
      return await unwrapDeadLetterCumulusMessage(unwrappedMessageBody);
    }
    if (isEventBridgeEvent(messageBody)) {
      return await getCumulusMessageFromExecutionEvent(
        messageBody
      );
    }
    if (isCumulusMessageLike(messageBody)) {
      return messageBody;
    }
    throw new TypeError('DeadLetter CumulusMessage in unrecognized format');
  } catch (error) {
    log.error(
      'Falling back to storing wrapped message after encountering unwrap error',
      error
    );
    return messageBody;
  }
};
