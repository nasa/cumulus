/**
 * TODO
 */
const { Map, List, fromJS } = require('immutable');
const api = require('../ops-api');

const WORKFLOW_STATUS_IN_FLIGHT = 'WORKFLOW_STATUS_IN_FLIGHT';
const WORKFLOW_STATUS_RCVD = 'WORKFLOW_STATUS_RCVD';
const initialState = Map({ workflows: List(), inFlight: false, error: undefined });

const reducer = (state = initialState, action) => {
  switch (action.type) {
    case WORKFLOW_STATUS_IN_FLIGHT:
      return state.set('inFlight', true);
    case WORKFLOW_STATUS_RCVD:
      return state.set('workflows', fromJS(action.workflows))
        .set('inFlight', false)
        .set('error', action.error);
    default:
      return state;
  }
};

/**
 * fetchWorkflowStatus - An action creator that initiates a request to fetch the workflow status
 *
 * @param  config   Application configuration
 * @param  dispatch Function to dispatch a change to update the store.
 */
function fetchWorkflowStatus(config, dispatch) {
  dispatch({ type: WORKFLOW_STATUS_IN_FLIGHT });
  api.getWorkflowStatus(config)
  .then((resp) => {
    dispatch({ type: WORKFLOW_STATUS_RCVD, workflows: resp });
  })
  .catch((err) => {
    dispatch({ type: WORKFLOW_STATUS_RCVD, error: err.message });
  });
}

module.exports = {
  reducer,
  fetchWorkflowStatus
};
