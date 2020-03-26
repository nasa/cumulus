const { JSONPath } = require('jsonpath-plus');
const s3Utils = require('@cumulus/aws-client/S3');
const Logger = require('@cumulus/logger');

const log = new Logger({
  sender: '@cumulus/message/StepFunctions'
});

const pullStepFunctionEvent = async (event) => {
  if (!event.replace) return event;

  const remoteMsg = await s3Utils.getJsonS3Object(
    event.replace.Bucket,
    event.replace.Key
  );

  let returnEvent = remoteMsg;
  if (event.replace.TargetPath) {
    const replaceNodeSearch = JSONPath({
      path: event.replace.TargetPath,
      json: event,
      resultType: 'all'
    });
    if (replaceNodeSearch.length !== 1) {
      throw new Error(`Replacement TargetPath ${event.replace.TargetPath} invalid`);
    }
    if (replaceNodeSearch[0].parent) {
      replaceNodeSearch[0].parent[replaceNodeSearch[0].parentProperty] = remoteMsg;
      returnEvent = event;
      delete returnEvent.replace;
    }
  }
  return returnEvent;
};

const parseStepMessage = async (stepMessage, stepName) => {
  let parsedStepMessage = stepMessage;
  if (stepMessage.cma) {
    parsedStepMessage = { ...stepMessage, ...stepMessage.cma, ...stepMessage.cma.event };
    delete parsedStepMessage.cma;
    delete parsedStepMessage.event;
  }

  if (parsedStepMessage.replace) {
    // Message was too large and output was written to S3
    log.info(`Retrieving ${stepName} output from ${JSON.stringify(parsedStepMessage.replace)}`);
    parsedStepMessage = await pullStepFunctionEvent(parsedStepMessage);
  }
  return parsedStepMessage;
};

module.exports = {
  pullStepFunctionEvent,
  parseStepMessage
}
