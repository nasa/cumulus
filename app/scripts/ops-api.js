/**
 * Provides functions for accessing the GIBS Ops API.
 */
const { fromJS } = require('immutable');
const rp = require('request-promise');
const canned = require('./ops-api/canned-data');
/**
 * getApiHealth - Gets the health of the Ops API
 *
 * @param  config APP configuration
 * @return A promise delivering the health.
 */
const getApiHealth = config => rp({ uri: `${config.get('apiBaseUrl')}/health`, json: true });

/**
 * Parses a date if present.
 */
const safeDateParse = d => (d ? Date.parse(d) : null);

/**
 * parseExecution - Parses the execution section of a workflow to convert dates to longs.
 */
const parseExecution = execution =>
  execution.updateIn(['start_date'], safeDateParse).updateIn(['stop_date'], safeDateParse);

/**
 * Parses the workflow from a workflow response.
 */
const parseWorkflow = workflow => workflow.updateIn(['executions'], es => es.map(parseExecution));

 /**
  * getWorkflowStatus - Fetches the list of workflow status details.
  *
  * @param  config APP configuration
  * @return A promise delivering the list of workflow statuses.
  */
const getWorkflowStatus = async (config, numExecutions = 30) => {
  let workflows;
  if (config.get('useCannedData')) {
    workflows = canned.getWorkflowStatusResp;
  }
  else {
    workflows = await rp(
      { uri: `${config.get('apiBaseUrl')}/workflow_status`,
        qs: { stack_name: config.get('stackName'), num_executions: numExecutions },
        json: true });
  }
  return fromJS(workflows).map(parseWorkflow);
};

module.exports = {
  getApiHealth,
  getWorkflowStatus
};
