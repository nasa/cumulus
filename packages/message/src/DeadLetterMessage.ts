//@ts-check
import { SQSRecord } from 'aws-lambda';
import moment from 'moment';

import { uuid } from 'uuidv4';
import { isEventBridgeEvent, StepFunctionEventBridgeEvent } from '@cumulus/aws-client/Lambda';
import { parseSQSMessageBody, isSQSRecordLike } from '@cumulus/aws-client/SQS';
import { CumulusMessage } from '@cumulus/types/message';
import { DLQRecord, DLARecord } from '@cumulus/types/api/dead_letters';
import Logger from '@cumulus/logger';
import { MessageGranule } from '@cumulus/types';
import { isMessageWithProvider, getMessageProviderId } from './Providers';
import { isCumulusMessageLike } from './CumulusMessage';
import { getCumulusMessageFromExecutionEvent } from './StepFunctions';
import { constructCollectionId } from './Collections';

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

interface PayloadWithGranules {
  granules: Array<MessageGranule>
}

const payloadHasGranules = (payload: any): payload is PayloadWithGranules => (
  payload instanceof Object
  && 'granules' in payload
  && Array.isArray(payload.granules)
);

const extractCollectionId = (message: CumulusMessage): string | null => {
  const collectionName = message?.meta?.collection?.name || null;
  const collectionVersion = message?.meta?.collection?.version || null;
  if (collectionName && collectionVersion) {
    return constructCollectionId(collectionName, collectionVersion);
  }
  return null;
};

const extractGranules = (message: CumulusMessage): Array<string | null> | null => {
  if (payloadHasGranules(message.payload)) {
    return message.payload.granules.map((granule) => granule?.granuleId || null);
  }
  return null;
};

type DLQMetadata = Partial<DLQRecord> & { body: undefined };
/**
 * peel out metadata from an SQS(/DLQ)record
 * @param message DLQ or SQS message
 * @returns the given message without its body
 */
const extractSQSMetadata = (message: DLQRecord | SQSRecord): DLQMetadata => {
  const metadata = { ...message } as any;
  delete metadata.body;
  delete metadata.Body;
  return metadata;
};

/**
 * Reformat object with key attributes at top level.
 *
 */
export const hoistCumulusMessageDetails = async (dlqRecord: SQSRecord): Promise<DLARecord> => {
  let executionArn = null;
  let stateMachineArn = null;
  let status = null;
  let time = null;
  let collectionId = null;
  let granules = null;
  let providerId = null;

  let messageBody;
  messageBody = dlqRecord;
  let metadata = extractSQSMetadata(messageBody);
  /* de-nest sqs records of unknown depth */
  while (isSQSRecordLike(messageBody)) {
    /* prefer outermost recorded metadata */
    metadata = { ...extractSQSMetadata(messageBody), ...metadata };
    messageBody = parseSQSMessageBody(messageBody);
  }
  const error = 'error' in metadata ? metadata.error : null;
  if (isEventBridgeEvent(messageBody)) {
    executionArn = messageBody?.detail?.executionArn || null;
    stateMachineArn = messageBody?.detail?.stateMachineArn || null;
    status = messageBody?.detail?.status || null;
    time = messageBody?.time || null;
    let cumulusMessage;
    try {
      cumulusMessage = await getCumulusMessageFromExecutionEvent(messageBody);
    } catch (error_) {
      cumulusMessage = undefined;
      log.error(
        'could not parse details from DLQ message body',
        error_,
        messageBody
      );
    }
    if (cumulusMessage) {
      collectionId = extractCollectionId(cumulusMessage);
      granules = extractGranules(cumulusMessage);
      if (isMessageWithProvider(cumulusMessage)) {
        providerId = getMessageProviderId(cumulusMessage) || null;
      }
    }
  } else {
    log.error(
      'could not parse details from DLQ message body',
      messageBody,
      'expected EventBridgeEvent'
    );
  }
  return {
    ...metadata,
    body: JSON.stringify(messageBody),
    collectionId,
    providerId,
    granules,
    executionArn,
    stateMachineArn,
    status,
    time,
    error,
  } as DLARecord; // cast to DLARecord: ts is confused by explicit 'undefined' fields in metadata
};

export const getDLARootKey = (stackName: string) => (
  `${stackName}/dead-letter-archive/sqs/`
);

export const extractDateString = (message: DLARecord): string => (
  message.time && moment.utc(message.time).isValid() ? moment.utc(message.time).format('YYYY-MM-DD') : moment.utc().format('YYYY-MM-DD')
);

export const extractFileName = (message: DLARecord): string => {
  // get token after the last / or :
  const executionName = message.executionArn ? message.executionArn.split(/[/:]/).pop() : 'unknown';
  return `${executionName}-${uuid()}`;
};

export const getDLAKey = (stackName: string, message: DLARecord): string => {
  const dateString = extractDateString(message);
  const fileName = extractFileName(message);
  return `${getDLARootKey(stackName)}${dateString}/${fileName}`;
};

export const getDLAFailureKey = (stackName: string, message: DLARecord): string => {
  const dateString = extractDateString(message);
  const fileName = extractFileName(message);
  return `${stackName}/dead-letter-archive/failed-sqs/${dateString}/${fileName}`;
};
