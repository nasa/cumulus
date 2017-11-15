'use strict';

const path = require('path');
const fs = require('fs');
const message = require('./lib/message');

// The filesystem location of the Lambda module
const TASK_ROOT = 'example';

/**
 * Returns an absolute path given a relative path within the task directory (TASK_ROOT)
 * @param {String} relativePath The relative path to resolve
 * @returns {String} The absolute path for the given relative path
 */
function taskPath(relativePath) {
  return path.resolve(__dirname, TASK_ROOT, relativePath);
}

/**
 * @returns {Promise} A promise resolving to the parsed contents of cumulus.json
 */
function promiseTaskConfig() {
  return new Promise((resolve, reject) => {
    const filePath = taskPath('cumulus.json');
    fs.readFile(filePath, (err, data) => {
      if (err) return reject(err);
      try {
        const result = JSON.parse(data.toString());
        return resolve(result);
      }
      catch (e) {
        return reject(e);
      }
    });
  });
}

/**
 * Returns the handler function for the given module.function string
 * @param {String} handlerString The handler location as it would be passed to Lambda (e.g. "index.handler")
 * @returns {Function} The handler function corresponding to the string
 */
function getNestedHandler(handlerString) {
  const errorHandler = (err) => (event, context, callback) => callback(err);

  const parts = handlerString.split('.');
  if (parts.length !== 2) {
    return errorHandler(`Bad handler ${handlerString}`);
  }
  const moduleName = parts[0];
  const handlerName = parts[1];
  try {
    const app = require(taskPath(moduleName)); // eslint-disable-line global-require
    const handler = app[handlerName];

    if (!handler) {
      return errorHandler(`Handler '${handlerName}' missing on module '${moduleName}'`);
    }
    return handler;
  }
  catch (e) {
    return errorHandler(e);
  }
}

/**
 * Given a Lambda handler, event, and context, invokes the handler with the given event.
 * @param {Function} handler The Lambda handler to invoke
 * @param {*} event The event to pass to the Lambda.  Note: this is passed verbatim with no interpretation
 * @param {*} context The context object for the Lambda. done/succeed/fail methods will not be used
 * @returns {Promise} A Promise that resolves to the callback value of the handler or rejects if it errors
 */
function invokeHandler(handler, event, context) {
  return new Promise((resolve, reject) => {
    const callback = (err, data) => {
      if (err) reject(err);
      else resolve(data);
    };
    const nestedContext = Object.assign({}, {
      done: callback,
      succeed: (data) => callback(null, data),
      fail: (err) => callback(err)
    }, context);
    handler(event, nestedContext, callback);
  });
}

/**
 * Lambda handler. Interprets incoming messages, passes them to an inner handler, gets the response
 * and transforms it into an outgoing message, returned by Lambda. Asynchronous.
 *
 * @param {*} event The Lambda event, a Cumulus protocol message
 * @param {*} context The Lambda context
 * @param {*} callback The Lambda callback, called with a Cumulus protocol output message
 */
module.exports = function sledHandler(event, context, callback) {
  let taskConfig = null;
  let nestedHandler = null;
  let messageConfig = null;
  let fullEvent = null;
  promiseTaskConfig()
    .then((config) => {
      taskConfig = config.task || {};
      nestedHandler = getNestedHandler(taskConfig.entrypoint || 'index.handler');
      return message.loadRemoteEvent(event);
    })
    .then((remoteEvent) => {
      fullEvent = remoteEvent;
      return message.loadNestedEvent(fullEvent);
    })
    .then((nestedEvent) => {
      messageConfig = nestedEvent.messageConfig;
      delete nestedEvent.messageConfig; // eslint-disable-line no-param-reassign
      return invokeHandler(nestedHandler, nestedEvent, context);
    })
    .then((handlerResponse) => message.createNextEvent(handlerResponse, fullEvent, messageConfig))
    .then((nextEvent) => callback(null, nextEvent))
    .catch((err) => {
      if (err.name && err.name.includes('WorkflowError')) {
        callback(null, Object.assign({}, fullEvent, { payload: null, exception: err.name }));
      }
      else {
        callback(err);
      }
    });
};

// Local testing. Run the handler.
if (process.argv[2] === 'local') {
  if (!process.argv[3]) throw new Error('Message identifier required');

  const messageName = process.argv[3];
  const event = JSON.parse(fs.readFileSync(`example/messages/${messageName}.input.json`, 'utf8'));
  const expectedOutputObj = JSON.parse(fs.readFileSync(`example/messages/${messageName}.output.json`, 'utf8'));
  const expectedOutput = JSON.stringify(expectedOutputObj);

  module.exports(event, {}, (err, data) => {
    if (err) {
      console.error('ERROR', err, err.stack);
    }
    else {
      const output = JSON.stringify(data);
      if (output !== expectedOutput) {
        throw new Error(`Bad output.  Expected:\n${expectedOutput}\nGot:\n${output}`);
      }
      console.log('Success', data);
    }
  });
}