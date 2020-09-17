'use strict';

const get = require('lodash/get');
const { parseSQSMessageBody, sendSQSMessage } = require('@cumulus/aws-client/SQS');
const log = require('@cumulus/common/log');
const { getMessageExecutionArn } = require('@cumulus/message/Executions');
const { getKnexClient } = require('@cumulus/db');
const Execution = require('../models/executions');
const Granule = require('../models/granules');
const Pdr = require('../models/pdrs');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

const saveExecutionToDb = async (cumulusMessage) => {
  const executionModel = new Execution();
  try {
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
  } catch (error) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create/update database record for execution ${executionArn}: ${error.message}`);
    throw error;
  }
};

const savePdrToDb = async (cumulusMessage) => {
  const pdrModel = new Pdr();
  try {
    await pdrModel.storePdrFromCumulusMessage(cumulusMessage);
  } catch (error) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create/update PDR database record for execution ${executionArn}: ${error.message}`);
    throw error;
  }
};

const saveGranulesToDb = async ({ db, cumulusMessage }) => {
  const granuleModel = new Granule();

  try {
    await granuleModel.storeGranulesFromCumulusMessage({
      db,
      cumulusMessage,
    });
  } catch (error) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create/update granule records for execution ${executionArn}: ${error.message}`);
    throw error;
  }
};

const handler = async (event) => {
  const sqsMessages = get(event, 'Records', []);

  return Promise.all(sqsMessages.map(async (message) => {
    const executionEvent = parseSQSMessageBody(message);
    const cumulusMessage = await getCumulusMessageFromExecutionEvent(executionEvent);

    const db = await getKnexClient();

    const results = await Promise.allSettled([
      saveExecutionToDb(cumulusMessage),
      saveGranulesToDb({ db, cumulusMessage }),
      savePdrToDb(cumulusMessage),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      log.fatal(`Writing message failed: ${JSON.stringify(message)}`);
      return sendSQSMessage(process.env.DeadLetterQueue, message);
    }
    return results;
  }));
};

module.exports = {
  handler,
  saveExecutionToDb,
  saveGranulesToDb,
  savePdrToDb,
};
