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
const getApiHealth = (config) => {
  if (config.get('useCannedData')) {
    return { 'ok?': true };
  }
  return rp({ uri: `${config.get('apiBaseUrl')}/health`, json: true });
};

 /**
  * getWorkflowStatus - Fetches the list of workflow status details.
  *
  * @param  config APP configuration
  * @return A promise delivering the list of workflow statuses.
  */
const getWorkflowStatus = async (config) => {
  let workflows;
  if (config.get('useCannedData')) {
    workflows = canned.getWorkflowStatusResp;
  }
  else {
    workflows = await rp(
      { uri: `${config.get('apiBaseUrl')}/workflow_status`,
        qs: { stack_name: config.get('stackName') },
        json: true });
  }
  return fromJS(workflows);
};

 /**
  * getServiceStatus - Fetches the list of service status details.
  *
  * @param  config APP configuration
  * @return A promise delivering the list of service statuses.
  */
const getServiceStatus = async (config) => {
  let services;
  if (config.get('useCannedData')) {
    services = canned.getServiceStatusResp;
  }
  else {
    services = await rp(
      { uri: `${config.get('apiBaseUrl')}/service_status`,
        qs: {
          main_stack_name: config.get('stackName'),
          on_earth_stack_name: config.get('onEarthStackName')
        },
        json: true });
  }
  return fromJS(services);
};

module.exports = {
  getApiHealth,
  getWorkflowStatus,
  getServiceStatus
};
