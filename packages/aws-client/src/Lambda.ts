/**
 * @module Lambda
 */
import { InvocationType, InvokeCommand, InvokeCommandOutput } from '@aws-sdk/client-lambda';
import { EventBridgeEvent } from 'aws-lambda';
import Logger from '@cumulus/logger';
import { lambda } from './services';
import { inTestMode } from './test-utils';
const log = new Logger({ sender: 'aws-client/Lambda' });

export type StepFunctionEventBridgeEvent = EventBridgeEvent<'Step Functions Execution Status Change', { [key: string]: string }>;

/**
 * Bare check for EventBridge shape
 */
export const isEventBridgeEvent = (event: Object): event is StepFunctionEventBridgeEvent => (
  event instanceof Object
  && 'detail' in event
);

/**
 * Invoke a Lambda function
 */
export const invoke = async (name: string, payload: unknown, type: InvocationType = 'Event'): Promise<InvokeCommandOutput | undefined> => {
  if (process.env.IS_LOCAL || inTestMode()) {
    log.info(`Faking Lambda invocation for ${name}`);

    return undefined;
  }

  log.info(`Invoking ${name}`);

  let response;
  try {
    response = await lambda().send(new InvokeCommand({
      FunctionName: name,
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
      InvocationType: type,
    }));
  } catch (error) {
    log.error(`Error invoking ${name}`, error);
    throw error;
  }
  return response;
};
