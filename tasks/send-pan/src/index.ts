import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { Context } from 'aws-lambda';

import { pdrHelpers } from '@cumulus/api';
import { runCumulusTask, CumulusMessageWithAssignedPayload } from '@cumulus/cumulus-message-adapter-js';
import HttpProviderClient from '@cumulus/ingest/HttpProviderClient';
import S3ProviderClient from '@cumulus/ingest/S3ProviderClient';
import Logger from '@cumulus/logger';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';

import { HandlerEvent, HandlerOutput } from './types';

const log = new Logger({ sender: '@cumulus/send-pan' });

const buildUploaderClient = (
  providerConfig: {
    protocol: string,
    host: string,
  }
) => {
  switch (providerConfig.protocol) {
    case 'http':
    case 'https':
      return new HttpProviderClient(providerConfig);
    case 's3':
      return new S3ProviderClient({ bucket: providerConfig.host });
    default:
      throw new Error(`Protocol ${providerConfig.protocol} is not supported.`);
  }
};

/**
 * Send PAN and return the uri of the uploaded pan
 *
 * @param {object} event - input from the message adapter
 * @returns {object} the uri of the pan
 */
async function sendPAN(event: HandlerEvent): Promise<HandlerOutput> {
  const { config, input } = event;
  const provider = config.provider;
  const remoteDir = config.remoteDir || 'pans';
  const panType = config.panType || 'shortPan';

  const panName = input.pdr.name.replace(/\.pdr/gi, '.PAN');
  const uploadPath = path.join(remoteDir, panName);

  if (input.running.length !== 0) {
    throw new Error('Executions still running');
  }
  let pan;
  switch (panType) {
    case 'longPanAlways': {
      pan = await pdrHelpers.generateLongPAN([...input.completed, ...input.failed]);
      log.debug('Created long PAN');
      break;
    }
    case 'shortPan': {
      const disposition = (input.failed.length > 0) ? 'FAILED' : 'SUCCESSFUL';
      pan = pdrHelpers.generateShortPAN(disposition);
      log.debug('Created short PAN');
      break;
    }
    case 'longPan': {
      if (input.failed.length + input.completed.length <= 1) {
        const disposition = (input.failed.length > 0) ? 'FAILED' : 'SUCCESSFUL';
        pan = pdrHelpers.generateShortPAN(disposition);
        log.debug('Created short PAN');
      } else {
        pan = await pdrHelpers.generateLongPAN([...input.completed, ...input.failed]);
        log.debug('Created long PAN');
      }
      break;
    }
    default: {
      throw new Error(`Unknown panType: ${panType}, must be shortPan, longPan, or longPanAlways`);
    }
  }

  const localPath = path.join(tmpdir(), panName);
  fs.writeFileSync(localPath, pan);

  const providerClient = buildUploaderClient(provider);
  const uri = await providerClient.upload({ localPath, uploadPath });
  log.debug(`sent pan to ${uri}`);

  fs.unlinkSync(localPath);
  return {
    ...input,
    pan: { uri },
  };
}

/**
 * Lambda handler
 *
 * @param {object} event      - a Cumulus Message
 * @param {object} context    - an AWS Lambda context
 * @returns {Promise<CumulusMessageWithAssignedPayload | CumulusRemoteMessage>} -
 *   Returns output from task.
 *   See schemas/output.json for detailed output schema
 */
export const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessageWithAssignedPayload
| CumulusRemoteMessage> => await runCumulusTask(sendPAN, event, context);

exports.handler = handler;
exports.sendPAN = sendPAN; // exported to support testing
