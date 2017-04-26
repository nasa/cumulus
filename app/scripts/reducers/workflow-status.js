/**
 * Handles fetching and saving the workflow status in the state. Workflow status the name, and
 * execution dates of the workflows.
 */
const { Map, List, fromJS } = require('immutable');
const api = require('../ops-api');

// Actions
const WORKFLOW_STATUS_IN_FLIGHT = 'WORKFLOW_STATUS_IN_FLIGHT';
const WORKFLOW_STATUS_RCVD = 'WORKFLOW_STATUS_RCVD';
const WORKFLOW_CHANGE_SORT = 'WORKFLOW_CHANGE_SORT';

// Sort Fields
const SORT_NONE = 'SORT_NONE';
const SORT_NAME = 'SORT_NAME';
const SORT_LAST_COMPLETED = 'SORT_LAST_COMPLETED';
const SORT_SUCCESS_RATE = 'SORT_SUCCESS_RATE';
const SORT_NUM_RUNNING = 'SORT_NUM_RUNNING';

const initialState = Map(
  { workflows: List(),
    sort: Map({ field: SORT_NONE, ascending: true }),
    inFlight: false,
    error: undefined });

/**
 * Returns all the exections in a workflow that are not running.
 */
const nonRunningExecutions = workflow =>
  workflow.get('executions')
  .filter(v => v.get('status') !== 'RUNNING');

/**
 * Gets the last completed execution of a workflow.
 */
const getLastCompleted = workflow => nonRunningExecutions(workflow).first();


/**
 * Returns a map containing the number of successful runs and the total number of executions that
 * completed.
 */
const getSuccessRate = (workflow) => {
  const executions = nonRunningExecutions(workflow);
  const numSuccessful = executions.filter(v => v.get('status') === 'SUCCEEDED').count();
  return Map({ numSuccessful, numExecutions: executions.count() });
};

/**
 *  Returns the number of running executions in the workflow
 */
const getNumRunning = workflow =>
  workflow.get('executions').filter(v => v.get('status') === 'RUNNING').count();

/**
 * Reducer helper function. Takes the current state and a field to sort the workflows. Sorts the
 * workflows by the given field reversing the sort if it's already sorted by that.
 */
const sortWorkflows = (state, field) => {
  let sorter;
  const now = Date.now();
  switch (field) {
    case SORT_NAME:
      sorter = w => w.get('name');
      break;
    case SORT_LAST_COMPLETED:
      sorter = (w) => {
        const last = getLastCompleted(w);
        if (last) {
          return now - last.get('stop_date');
        }
        return Number.MAX_VALUE;
      };
      break;
    case SORT_SUCCESS_RATE:
      sorter = w => getSuccessRate(w).get('numSuccessful');
      break;
    case SORT_NUM_RUNNING:
      sorter = w => getNumRunning(w);
      break;
    default:
      throw new Error(`Unexpected sort field ${field}`);
  }
  // Update the sort field or direction
  let newState = state.updateIn(['sort'], (s) => {
    if (s.get('field') === field) {
      // switch direction
      return s.updateIn(['ascending'], a => !a);
    }
    return s.set('field', field);
  });
  // Sort the workflows
  // First sort by name to produce a stable sort if values match
  newState = newState.updateIn(['workflows'], ws => ws.sortBy(w => w.get('name')));
  // Then sort by the designated sort
  newState = newState.updateIn(['workflows'], ws => ws.sortBy(sorter));
  // Sort by ascending/descending if necessary
  if (!newState.getIn(['sort', 'ascending'])) {
    return newState.updateIn(['workflows'], ws => ws.reverse());
  }
  return newState;
};

/**
 * Main reducer function for workflow status state.
 */
const reducer = (state = initialState, action) => {
  switch (action.type) {
    case WORKFLOW_STATUS_IN_FLIGHT:
      return state.set('inFlight', true);
    case WORKFLOW_STATUS_RCVD:
      return state.set('workflows', fromJS(action.workflows))
        .set('inFlight', false)
        .set('error', action.error);
    case WORKFLOW_CHANGE_SORT:
      return sortWorkflows(state, action.field);
    default:
      return state;
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////////
// Actions


/**
 * Creates an action to indicate a change in the workflow sort.
 */
const changeSort = field => ({ type: WORKFLOW_CHANGE_SORT, field: field });

/**
 * fetchWorkflowStatus - An action creator that initiates a request to fetch the workflow status
 *
 * @param  config   Application configuration
 * @param  dispatch Function to dispatch a change to update the store.
 */
const fetchWorkflowStatus = (config, dispatch) => {
  dispatch({ type: WORKFLOW_STATUS_IN_FLIGHT });
  api.getWorkflowStatus(config)
  .then((resp) => {
    dispatch({ type: WORKFLOW_STATUS_RCVD, workflows: resp });
  })
  .catch((err) => {
    dispatch({ type: WORKFLOW_STATUS_RCVD, error: err.message });
  });
};

module.exports = {
  reducer,

  SORT_NONE,
  SORT_NAME,
  SORT_LAST_COMPLETED,
  SORT_SUCCESS_RATE,
  SORT_NUM_RUNNING,

  // helpers
  getNumRunning,
  getSuccessRate,
  getLastCompleted,

  // Actions
  changeSort,
  fetchWorkflowStatus,

  // for testing
  sortWorkflows
};
