/**
 * Provides functions for accessing the GIBS Ops API.
 */
const { fromJS } = require('immutable');
const rp = require('request-promise');

// TODO add tests for workflow parsing

/**
 * getApiHealth - Gets the health of the Ops API
 *
 * @param  config APP configuration
 * @return A promise delivering the health.
 */
function getApiHealth(config) {
  return rp({ uri: `${config.apiBaseUrl}/health`, json: true });
}

/**
 * Parses a date if present.
 */
const safeDateParse = d => (d ? Date.parse(d) : null);


/**
 * parseExecution - Parses the execution section of a workflow to convert dates to longs.
 */
function parseExecution(execution) {
  return execution.updateIn(['start_date'], safeDateParse)
    .updateIn(['end_date'], safeDateParse);
}

/**
 * Parses the workflow from a workflow response.
 */
function parseWorkflow(workflow) {
  return workflow.updateIn(['executions'], es => es.map(parseExecution));
}

 /**
  * getWorkflowStatus - Fetches the list of workflow status details.
  *
  * @param  config APP configuration
  * @return A promise delivering the list of workflow statuses.
  */
async function getWorkflowStatus(config, numExecutions = 30) {
  const workflows = await rp(
    { uri: `${config.apiBaseUrl}/workflow_status`,
      qs: { stack_name: config.stackName, num_executions: numExecutions },
      json: true });
  return fromJS(workflows).map(parseWorkflow);
}

module.exports = {
  getApiHealth,
  getWorkflowStatus
};
