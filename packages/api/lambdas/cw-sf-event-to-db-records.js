'use strict';

const log = require('@cumulus/common/log');
const { getMessageExecutionArn } = require('@cumulus/common/message');
const Execution = require('../models/executions');
const Granule = require('../models/granules');
const { getCumulusMessageFromExecutionEvent } = require('../lib/cwSfExecutionEventUtils');

const saveExecutionToDb = async (cumulusMessage) => {
  const executionModel = new Execution();

  try {
    await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);
  } catch (err) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create database record for execution ${executionArn}: ${err.message}`);
  }
};

const saveGranulesToDb = async (cumulusMessage) => {
  const granuleModel = new Granule();

  try {
    await granuleModel.storeGranulesFromCumulusMessage(cumulusMessage);
  } catch (err) {
    const executionArn = getMessageExecutionArn(cumulusMessage);
    log.fatal(`Failed to create granule records for execution ${executionArn}: ${err.message}`);
  }
};

const handler = async (event) => {
  const cumulusMessage = await getCumulusMessageFromExecutionEvent(event);

  await Promise.all([
    saveExecutionToDb(cumulusMessage),
    saveGranulesToDb(cumulusMessage)
  ]);
};

module.exports = {
  handler,
  saveExecutionToDb,
  saveGranulesToDb
};
