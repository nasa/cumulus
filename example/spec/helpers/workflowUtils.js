'use strict';

const get = require('lodash/get');

function isReingestExecution(taskInput) {
  return get(
    taskInput,
    'cumulus_meta.cumulus_context.reingestGranule',
    false
  );
}

function isExecutionForGranuleId(taskInput, granuleId) {
  return get(taskInput, 'payload.granules[0].granuleId') === granuleId;
}

/**
 * Given a Cumulus Message and a granuleId, test if the message is a re-ingest
 * of the granule.
 *
 * This is used as the `findExecutionFn` parameter of the
 * `waitForTestExecutionStart` function.
 *
 * @param {Object} taskInput - a full Cumulus Message
 * @param {Object} findExecutionFnParams
 * @param {string} findExecutionFnParams.granuleId
 * @returns {boolean}
 */
function isReingestExecutionForGranuleId(taskInput, { granuleId }) {
  return isReingestExecution(taskInput) &&
    isExecutionForGranuleId(taskInput, granuleId);
}

module.exports = {
  isReingestExecutionForGranuleId
};
