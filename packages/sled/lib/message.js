'use strict';

//////////////////////////////////
// Input message interpretation //
//////////////////////////////////

function loadRemoteEvent(event) {
  if (event.replace) {
    console.log('TODO loadRemoteEvent');
    return Promise.resolve(event);
  }
  return Promise.resolve(event);
}

function loadLocalConfig(event) {
  const task = event.ingest_meta.task;
  return Promise.resolve(event.workflow_config_template[task]);
}

function loadStepFunctionConfig(event) {
  throw new Error('loadStepFunctionConfig is not implemented');
}

function loadConfig(event) {
  const source = event.ingest_meta.message_source;
  if (!source) throw new Error('ingest_meta requires a message_source');
  if (source === 'local') {
    return loadLocalConfig(event);
  }
  if (source === 'sfn') {
    return loadStepFunctionConfig(event);
  }
}

function resolveConfigVars(event, config) {
  // TODO Implement
  return config;
}

function resolvePayload(event, config) {
  // TODO Implement
  return event.payload;
}

/**
 * Interprets an incoming event as a Cumulus workflow message
 *
 * @param {*} event The input message sent to the Lambda
 * @param {*} context The context sent to the Lambda
 * @returns {Promise} A promise resolving to a message that is ready to pass to an inner task
 */
function loadNestedEvent(event, context) {
  return loadRemoteEvent(event)
    .then((fullEvent) => {
      return loadConfig(fullEvent)
        .then((config) => {
          const finalConfig = resolveConfigVars(fullEvent, config);
          const finalPayload = resolvePayload(fullEvent, config);
          return {
            payload: finalPayload,
            config: finalConfig
          };
        });
    });
}

/////////////////////////////
// Output message creation //
/////////////////////////////

/**
 * Creates the output message returned by a task
 *
 * @param {*} nestedResponse The response returned by the inner task code
 * @param {*} event The input message sent to the Lambda
 * @param {*} context The context sent to the Lambda
 * @returns {Promise} A promise resolving to the output message to be returned
 */
function createNextEvent(nestedResponse, event, context) {
  // TODO
  const result = Object.assign({}, event);
  const payload = nestedResponse;
  result.payload = payload;
  return Promise.resolve(result);
}

/////////////
// Exports //
/////////////

module.exports = {
  loadNestedEvent: loadNestedEvent,
  createNextEvent: createNextEvent
};