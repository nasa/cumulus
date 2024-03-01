//@ts-check
import { SQSRecord } from 'aws-lambda';
import { parseSQSMessageBody, isSQSRecordLike } from '@cumulus/aws-client/SQS';
import { CumulusMessage } from '@cumulus/types/message';
import { DLQRecord } from '@cumulus/types/api/dead_letters';
import { isEventBridgeEvent, StepFunctionEventBridgeEvent } from '@cumulus/aws-client/Lambda';
import Logger from '@cumulus/logger';

import { isCumulusMessageLike } from './CumulusMessage';
import { getCumulusMessageFromExecutionEvent } from './StepFunctions';

const log = new Logger({ sender: '@cumulus/DeadLetterMessage' });

type UnwrapDeadLetterCumulusMessageInputType = (
  StepFunctionEventBridgeEvent
  | DLQRecord | SQSRecord
  | CumulusMessage
);

/**
 * Bare check for SQS message Shape
 */
export const isDLQRecordLike = (message: Object): message is DLQRecord => (
  isSQSRecordLike(message)
  && 'error' in message
);

/**
 * Unwrap dead letter Cumulus message, which may be wrapped in a
 * States cloudwatch event, which is wrapped in an SQS message.
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
      error,
      JSON.stringify(messageBody)
    );
    return messageBody;
  }
};
