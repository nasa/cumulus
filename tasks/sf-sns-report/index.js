'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');

const throwDisabledError = () => {
  throw new Error(
    '@cumulus/sf-sns-report has been deprecated due to a change in reporting architecture. As the '
    + 'reporting SNS topic has become read-only and all consumers of it have been removed, this '
    + 'task has been disabled. Use @cumulus/sf-sqs-report for mid-workflow updates instead.'
  );
};

/**
 * Lambda handler.
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context object
 * @param {Function} callback - an AWS Lambda callback
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(throwDisabledError, event, context, callback);
}

exports.handler = handler;
