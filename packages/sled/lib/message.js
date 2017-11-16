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

/**
 * Given a state machine arn and execution name, returns the execution's ARN
 * @param {string} stateMachineArn The ARN of the state machine containing the execution
 * @param {string} executionName The name of the execution
 * @returns {string} The execution's ARN
 */
function getSfnExecutionArnByName(stateMachineArn, executionName) {
  return [stateMachineArn.replace(':stateMachine:', ':execution:'), executionName].join(':');
}

/**
 * Given an execution history object returned by the StepFunctions API and an optional Activity
 * or Lambda ARN returns the most recent task name started for the given ARN, or if no ARN is
 * supplied, the most recent task started.
 *
 * IMPORTANT! If no ARN is supplied, this message assumes that the most recently started execution
 * is the desired execution. This WILL BREAK parallel executions, so always supply this if possible.
 *
 * @param {string} executionHistory The execution history returned by getExecutionHistory, assumed
 *                             to be sorted so most recent executions come last
 * @param {string} arn An ARN to an Activity or Lambda to find. See "IMPORTANT!"
 * @throws If no matching task is found
 * @returns {string} The matching task name
 */
function getTaskNameFromExecutionHistory(executionHistory, arn) {
  const eventsById = [];

  // Create a lookup table for finding events by their id
  for (const event of executionHistory.events) {
    eventsById[event.id] = event;
  }

  for (const step of executionHistory.events) {
    // Find the ARN in thie history (the API is awful here).  When found, return its
    // previousEventId's (TaskStateEntered) name
    if (arn &&
        ((step.type === 'LambdaFunctionScheduled' &&
          step.lambdaFunctionScheduledEventDetails.resource === arn) ||
         (step.type === 'ActivityScheduled' &&
          step.activityScheduledEventDetails.resource === arn))) {
      return eventsById[step.previousEventId].stateEnteredEventDetails.name;
    }
    else if (step.type === 'TaskStateEntered') return step.stateEnteredEventDetails.name;
  }
  throw new Error(`No task found for ${arn}`);
}

/**
 * Given a state machine ARN, an execution name, and an optional Activity or Lambda ARN returns
 * the most recent task name started for the given ARN in that execution, or if no ARN is
 * supplied, the most recent task started.
 *
 * IMPORTANT! If no ARN is supplied, this message assumes that the most recently started execution
 * is the desired execution. This WILL BREAK parallel executions, so always supply this if possible.
 *
 * @param {string} stateMachineArn The ARN of the state machine containing the execution
 * @param {string} executionName The name of the step function execution to look up
 * @param {string} arn An ARN to an Activity or Lambda to find. See "IMPORTANT!"
 * @returns {string} The name of the task being run
 */
function getCurrentSfnTask(stateMachineArn, executionName, arn) {
  const sfn = new AWS.StepFunctions({ apiVersion: '2016-11-23' });
  const executionArn = getSfnExecutionArnByName(stateMachineArn, executionName);
  return sfn.getExecutionHistory({
    executionArn: executionArn,
    maxResults: 40,
    reverseOrder: true
  }).promise()
    .then((executionHistory) => getTaskNameFromExecutionHistory(executionHistory, arn));
}

//////////////////////////////////
// Input message interpretation //
//////////////////////////////////

// Events stored externally

/**
 * Looks at a Cumulus message. If the message has part of its data stored remotely in
 * S3, fetches that data and returns it, otherwise it just returns the full message
 * @param {*} event The input Lambda event in the Cumulus message protocol
 * @returns {Promise} Promise that resolves to the full event data
 */
function loadRemoteEvent(event) {
  if (event.replace) {
    const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
    return s3.getObject(event.replace).promise()
      .then((data) => JSON.parse(data.Body.toString()));
  }
  return Promise.resolve(event);
}

// Loading task configuration from workload template

/**
 * Returns the configuration for the task with the given name, or an empty object if no
 * such task is configured.
 * @param {*} event An event in the Cumulus message format with remote parts resolved
 * @param {*} taskName The name of the Cumulus task
 * @returns {*} The configuration object
 */
function getConfig(event, taskName) {
  const config = event.workflow_config && event.workflow_config[taskName];
  return config || {};
}

/**
 * For local testing, returns the config for event.cumulus_meta.task
 * @param {*} event An event in the Cumulus message format with remote parts resolved
 * @returns {*} The task's configuration
 */
function loadLocalConfig(event) {
  const task = event.cumulus_meta.task;
  return Promise.resolve(getConfig(event, task));
}

/**
 * For StepFunctions, returns the configuration corresponding to the current execution
 * @param {*} event An event in the Cumulus message format with remote parts resolved
 * @param {*} context The context object passed to AWS Lambda or containing an activityArn
 * @returns {*} The task's configuration
 */
function loadStepFunctionConfig(event, context) {
  const meta = event.cumulus_meta;
  return getCurrentSfnTask(
    meta.state_machine,
    meta.execution_name,
    context.invokedFunctionArn || context.activityArn
  )
    .then((taskName) => getConfig(event, taskName));
}

/**
 * Given a Cumulus message and context, returns the config object for the task
 * @param {*} event An event in the Cumulus message format with remote parts resolved
 * @param {*} context The context object passed to AWS Lambda or containing an activityArn
 * @returns {*} The task's configuration
 */
function loadConfig(event, context) {
  const source = event.cumulus_meta.message_source;
  if (!source) throw new Error('cumulus_meta requires a message_source');
  if (source === 'local') {
    return loadLocalConfig(event);
  }
  if (source === 'sfn') {
    return loadStepFunctionConfig(event, context);
  }
  throw new Error(`Unknown event source: ${source}`);
}

// Config templating

/**
 * Given a Cumulus message (AWS Lambda event) and a string containing a JSONPath
 * template to interpret, returns the result of interpreting that template.
 *
 * Templating comes in three flavors:
 *   1. Single curly-braces within a string ("some{$.path}value"). The JSONPaths
 *      are replaced by the first value they match, coerced to string
 *   2. A string surrounded by double curly-braces ("{{$.path}}").  The function
 *      returns the first object matched by the JSONPath
 *   3. A string surrounded by curly and square braces ("{[$.path]}"). The function
 *      returns an array of all object matching the JSONPath
 *
 * It's likely we'll need some sort of bracket-escaping at some point down the line
 *
 * @param {*} event The Cumulus message
 * @param {*} str A string containing a JSONPath template to resolve
 * @returns {*} The resolved object
 */
function resolvePathStr(event, str) {
  const valueRegex = /^{{(.*)}}$/g;
  const arrayRegex = /^{\[(.*)\]}$/g;
  const templateRegex = /(?:^|[^\]){([^}]+)}/g;

  if (str.match(valueRegex)) {
    return JsonPath.value(event, str.substring(2, str.length - 2));
  }

  if (str.match(arrayRegex)) {
    return JsonPath.query(event, str.substring(2, str.length - 2));
  }

  return str.replace(templateRegex, (match, path) => JsonPath.value(event, path));
}

/**
 * Recursive helper for resolveConfigTemplates
 *
 * Given a config object containing possible JSONPath-templated values, resolves
 * all the values in the object using JSONPaths into the provided event.
 *
 * @param {*} event The event that paths resolve against
 * @param {*} config A config object, containing paths
 * @returns {*} A config object with all JSONPaths resolved
 */
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
/**
 * Given a config object containing possible JSONPath-templated values, resolves
 * all the values in the object using JSONPaths into the provided event.
 *
 * @param {*} event The event that paths resolve against
 * @param {*} config A config object, containing paths
 * @returns {*} A config object with all JSONPaths resolved
 */

function resolveConfigTemplates(event, config) {
  const taskConfig = Object.assign({}, config);
  delete taskConfig.cumulus_message;
  return resolveConfigObject(event, taskConfig);
}
// Payload determination

/**
 * Given a Cumulus message and its config, returns the input object to send to the
 * task, as defined under config.cumulus_message
 * @param {*} event The Cumulus message
 * @param {*} config The config object
 * @returns {*} The object to place on the input key of the task's event
 */
function resolveInput(event, config) {
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
function loadNestedEvent(event, context) {
  return loadConfig(event, context)
    .then((config) => {
      const finalConfig = resolveConfigTemplates(event, config);
      const finalPayload = resolveInput(event, config);
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

/**
 * Applies a task's return value to an output message as defined in config.cumulus_message
 *
 * @param {*} nestedResponse The task's return value
 * @param {*} event The output message to apply the return value to
 * @param {*} messageConfig The cumulus_message configuration
 * @returns {*} The output message with the nested response applied
 */
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

/**
 * Stores part of a response message in S3 if it is too big to send to StepFunctions
 * @param {*} event The response message
 * @returns {*} A response message, possibly referencing an S3 object for its contents
 */
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
