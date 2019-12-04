'use strict';

const log = require('@cumulus/common/log');
const { getMessageExecutionArn } = require('@cumulus/common/message');
const Execution = require('../models/executions');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

const handler = async (event) => {
  const cumulusMessage = await getCumulusMessageFromExecutionEvent(event);

  const executionModel = new Execution();

  try {
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
  } catch (err) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create database record for execution ${executionArn}: ${err.message}`);
  }
};

module.exports = { handler };
