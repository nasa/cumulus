import { SQSRecord, EventBridgeEvent } from 'aws-lambda';

import { parseSQSMessageBody } from '@cumulus/aws-client/SQS';
import { CumulusMessage } from '@cumulus/types/message';
import Logger from '@cumulus/logger';

import { getCumulusMessageFromExecutionEvent } from './StepFunctions';

const log = new Logger({ sender: '@cumulus/DeadLetterMessage' });

type StepFunctionEventBridgeEvent = EventBridgeEvent<'Step Functions Execution Status Change', { [key: string]: string }>;
type UnwrapDeadLetterCumulusMessageReturnType = (
  StepFunctionEventBridgeEvent
  | AWS.SQS.Message
  | SQSRecord
  | CumulusMessage
);

/**
 * Unwrap dead letter Cumulus message, which may be wrapped in a
 * States cloudwatch event, which is wrapped in an SQS message.
 *
 * @param {Object} messageBody - received SQS message
 * @returns {Object} the cumulus message or nearest available object
 */
export const unwrapDeadLetterCumulusMessage = async (
  messageBody: UnwrapDeadLetterCumulusMessageReturnType
): Promise<UnwrapDeadLetterCumulusMessageReturnType> => {
  try {
    if ('cumulus_meta' in messageBody) {
      return messageBody;
    }
    if ('Body' in messageBody || 'body' in messageBody) {
      // AWS.SQS.Message/SQS.Record case
      const unwrappedMessageBody = parseSQSMessageBody(
        messageBody
      ) as CumulusMessage;
      return await unwrapDeadLetterCumulusMessage(unwrappedMessageBody);
    }
    if (!('detail' in messageBody)) {
      // Non-typed catchall
      return messageBody;
    }
    // StepFunctionEventBridgeEvent case
    const unwrappedMessageBody = await getCumulusMessageFromExecutionEvent(messageBody);
    return await unwrapDeadLetterCumulusMessage(unwrappedMessageBody);
  } catch (error) {
    log.error(
      'Falling back to storing wrapped message after encountering unwrap error',
      error
    );
    return messageBody;
  }
};
