'use strict';

const JsonPath = require('../deps/jsonpath.min');

//////////////////////////////////
// Input message interpretation //
//////////////////////////////////

// Events stored externally

function loadRemoteEvent(event) {
  if (event.replace) {
    // TODO Implement this
    throw new Error('loadRemoteEvent is not implemented when events are in S3');
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
  // TODO: Implement this
  throw new Error('loadStepFunctionConfig is not implemented');
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
 * @param {*} context The context sent to the Lambda
 * @returns {Promise} A promise resolving to a message that is ready to pass to an inner task
 */
function loadNestedEvent(event) {
  return loadRemoteEvent(event)
    .then((fullEvent) =>
      loadConfig(fullEvent)
        .then((config) => {
          const finalConfig = resolveConfigTemplates(fullEvent, config);
          const finalPayload = resolvePayload(fullEvent, config);
          return {
            payload: finalPayload,
            config: finalConfig,
            messageConfig: config.cumulus_message
          };
        }));
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

function storeRemoteResponse(event) {
  // TODO Implement me
  return Promise.resolve(event);
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
  return storeRemoteResponse(result);
}

/////////////
// Exports //
/////////////

module.exports = {
  loadNestedEvent: loadNestedEvent,
  createNextEvent: createNextEvent
};