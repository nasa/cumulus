//@ts-check
import { SQSRecord, EventBridgeEvent } from 'aws-lambda';

import { parseSQSMessageBody } from '@cumulus/aws-client/SQS';
import { CumulusMessage } from '@cumulus/types/message';
import Logger from '@cumulus/logger';

import { getCumulusMessageFromExecutionEvent } from './StepFunctions';

const log = new Logger({ sender: '@cumulus/DeadLetterMessage' });

type StepFunctionEventBridgeEvent = EventBridgeEvent<'Step Functions Execution Status Change', { [key: string]: string }>;
type UnwrapDeadLetterCumulusMessageInputType = (
  StepFunctionEventBridgeEvent
  | AWS.SQS.Message
  | SQSRecord
);

/**
 * Bare check for CumulusMessage Shape
 *
 * @param {{ [key: string]: any }} message
 * @returns {message is CumulusMessage}
 */
export const isCumulusMessageLike = (message: Object): boolean => (
  message instanceof Object
  && 'cumulus_meta' in message
);

/**
 * Bare check for SQS message Shape
 * @param {{ [key: string]: any }} message
 * @returns {message is AWS.SQS.Message | SQSRecord}
 */
function isSQSRecordLike(message: Object): boolean {
  return (
    message instanceof Object
    && ('body' in message || 'Body' in message)
  );
}

/**
 * Bare check for EventBridge shape
 *
 * @param {{ [key: string]: any }} event
 * @returns {message is EventBridgeEvent}
 */
export const isEventBridgeLike = (event: Object): boolean => (
  event instanceof Object
  && 'detail' in event
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
): Promise<CumulusMessage | UnwrapDeadLetterCumulusMessageInputType> => {
  try {
    if (isSQSRecordLike(messageBody)) {
      // AWS.SQS.Message/SQS.Record case
      const unwrappedMessageBody = parseSQSMessageBody(
        messageBody as SQSRecord | AWS.SQS.Message
      ) as StepFunctionEventBridgeEvent;
      return await unwrapDeadLetterCumulusMessage(unwrappedMessageBody);
    }
    if (isEventBridgeLike(messageBody)) {
      return await getCumulusMessageFromExecutionEvent(
        messageBody as StepFunctionEventBridgeEvent
      );
    }
    if (isCumulusMessageLike(messageBody)) {
      return messageBody as CumulusMessage;
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
