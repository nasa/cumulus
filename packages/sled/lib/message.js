'use strict';

const JsonPath = require('../deps/jsonpath.min');
const AWS = require('aws-sdk');

/////////////////////////////
// AWS SDK Setup and Utils //
/////////////////////////////

const region = exports.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
if (region) {
  AWS.config.update({ region: region });
}

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: function addExpect100Continue() {} });
AWS.config.setPromisesDependency(Promise);


function getSfnExecutionByName(stateMachineArn, executionName) {
  return [stateMachineArn.replace(':stateMachine:', ':execution:'), executionName].join(':');
}

function getCurrentSfnTask(stateMachineArn, executionName) {
  const sfn = new AWS.StepFunctions({ apiVersion: '2016-11-23' });
  const executionArn = getSfnExecutionByName(stateMachineArn, executionName);
  sfn.getExecutionHistory({
    executionArn: executionArn,
    maxResults: 10,
    reverseOrder: true
  }).promise()
    .then((executionHistory) => {
      for (const step of executionHistory.events) {
        // Avoid iterating past states that have ended
        if (step.type.endsWith('StateExited')) break;
        if (step.type === 'TaskStateEntered') return step.stateEnteredEventDetails.name;
      }
      return Promise.reject(`No task found for ${stateMachineArn}#${executionName}`);
    });
}

//////////////////////////////////
// Input message interpretation //
//////////////////////////////////

// Events stored externally

function loadRemoteEvent(event) {
  if (event.replace) {
    const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
    return s3.getObject(event.replace).promise()
      .then((data) => JSON.parse(data.Body.toString()));
  }
  return Promise.resolve(event);
}

// Loading task configuration from workload template

function getConfig(event, taskName) {
  const config = event.workflow_config && event.workflow_config[taskName];
  return config || {};
}

function loadLocalConfig(event) {
  const task = event.cumulus_meta.task;
  return Promise.resolve(getConfig(event, task));
}

function loadStepFunctionConfig(event) {
  const meta = event.ingest_meta;
  return getCurrentSfnTask(meta.state_machine, meta.execution_name)
    .then((taskName) => getConfig(event, taskName));
}

function loadConfig(event) {
  const source = event.cumulus_meta.message_source;
  if (!source) throw new Error('cumulus_meta requires a message_source');
  if (source === 'local') {
    return loadLocalConfig(event);
  }
  if (source === 'sfn') {
    return loadStepFunctionConfig(event);
  }
  throw new Error(`Unknown event source: ${source}`);
}

// Config templating

function resolvePathStr(event, str) {
  const valueRegex = /^{{(.*)}}$/g;
  const arrayRegex = /^{\[(.*)\]}$/g;
  const templateRegex = /{([^}]+)}/g;

  if (str.match(valueRegex)) {
    return JsonPath.value(event, str.substring(2, str.length - 2));
  }

  if (str.match(arrayRegex)) {
    return JsonPath.query(event, str.substring(2, str.length - 2));
  }

  return str.replace(templateRegex, (match, path) => JsonPath.value(event, path));
}

function resolveConfigObject(event, config) {
  if (typeof config === 'string') {
    return resolvePathStr(event, config);
  }
  else if (Array.isArray(config)) {
    return config.map((c) => resolveConfigObject(event, c));
  }
  else if (config && typeof config === 'object') {
    const result = {};
    for (const key of Object.keys(config)) {
      result[key] = resolveConfigObject(event, config[key]);
    }
    return result;
  }
  return config;
}

function resolveConfigTemplates(event, config) {
  const taskConfig = Object.assign({}, config);
  delete taskConfig.cumulus_message;
  return resolveConfigObject(event, taskConfig);
}
// Payload determination

function resolvePayload(event, config) {
  const inputPath = config.cumulus_message && config.cumulus_message.input;
  if (inputPath) {
    return resolvePathStr(event, inputPath);
  }
  return event.payload;
}

/**
 * Interprets an incoming event as a Cumulus workflow message
 *
 * @param {*} event The input message sent to the Lambda
 * @returns {Promise} A promise resolving to a message that is ready to pass to an inner task
 */
function loadNestedEvent(event) {
  return loadConfig(event)
    .then((config) => {
      const finalConfig = resolveConfigTemplates(event, config);
      const finalPayload = resolvePayload(event, config);
      return {
        payload: finalPayload,
        config: finalConfig,
        messageConfig: config.cumulus_message
      };
    });
}

/////////////////////////////
// Output message creation //
/////////////////////////////

function assignOutputs(nestedResponse, event, messageConfig) {
  const outputs = messageConfig && messageConfig.outputs;
  const result = Object.assign({}, event);
  if (!outputs) {
    result.payload = nestedResponse;
    return result;
  }
  result.payload = {};
  for (const output of outputs) {
    const sourcePath = output.source;
    const destPath = output.destination;
    const destJsonPath = destPath.substring(2, destPath.length - 2);
    const value = resolvePathStr(nestedResponse, sourcePath);
    JsonPath.value(result, destJsonPath, value);
  }
  return result;
}

// https://gist.github.com/jed/982883
// eslint-disable-next-line
function uuid(a){return a?(a^Math.random()*16>>a/4).toString(16):([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,b)}

// Maximum message payload size that will NOT be stored in S3. Anything bigger will be.
const MAX_NON_S3_PAYLOAD_SIZE = 10000;

function storeRemoteResponse(event) {
  const jsonData = JSON.stringify(event);
  const roughDataSize = event ? jsonData.length : 0;

  if (roughDataSize < MAX_NON_S3_PAYLOAD_SIZE) {
    return Promise.resolve(event);
  }

  const s3Location = {
    Bucket: event.ingest_meta.message_bucket,
    Key: ['events', uuid()].join('/')
  };
  const s3Params = Object.assign({}, s3Location, {
    Expires: (7 * 24 * 60 * 60 * 1000) + new Date(), // Expire in a week
    Body: jsonData || '{}'
  });
  const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

  return s3.putObject(s3Params).promise()
    .then(() => ({
      cumulus_meta: event.cumulus_meta,
      replace: s3Location
    }));
}

/**
 * Creates the output message returned by a task
 *
 * @param {*} nestedResponse The response returned by the inner task code
 * @param {*} event The input message sent to the Lambda
 * @param {*} messageConfig The cumulus_message object configured for the task
 * @returns {Promise} A promise resolving to the output message to be returned
 */
function createNextEvent(nestedResponse, event, messageConfig) {
  const result = assignOutputs(nestedResponse, event, messageConfig);
  result.exception = 'None';
  delete result.replace;
  return storeRemoteResponse(result);
}

/////////////
// Exports //
/////////////

module.exports = {
  loadNestedEvent: loadNestedEvent,
  createNextEvent: createNextEvent,
  loadRemoteEvent: loadRemoteEvent
};
