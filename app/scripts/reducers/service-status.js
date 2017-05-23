/**
 * Handles fetching and saving the service status in the state.
 */
const { Map } = require('immutable');
const api = require('../ops-api');

// Actions
const SERVICE_STATUS_IN_FLIGHT = 'SERVICE_STATUS_IN_FLIGHT';
const SERVICE_STATUS_RCVD = 'SERVICE_STATUS_RCVD';

const initialState = Map(
  { services: null,
    inFlight: false,
    error: undefined });

/**
 * Main reducer function for workflow status state.
 */
const reducer = (state = initialState, action) => {
  switch (action.type) {
    case SERVICE_STATUS_IN_FLIGHT:
      return state.set('inFlight', true);
    case SERVICE_STATUS_RCVD:
      return state.set('services', action.services)
        .set('inFlight', false)
        .set('error', action.error);
    default:
      return state;
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////////
// Actions

/**
 * fetchServiceStatus - An action creator that initiates a request to fetch the workflow status
 *
 * @param  config   Application configuration
 * @param  dispatch Function to dispatch a change to update the store.
 */
const fetchServiceStatus = async (config, dispatch) => {
  dispatch({ type: SERVICE_STATUS_IN_FLIGHT });
  try {
    const resp = await api.getServiceStatus(config);
    dispatch({ type: SERVICE_STATUS_RCVD, services: resp });
  }
  catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    dispatch({ type: SERVICE_STATUS_RCVD, error: e.message });
  }
};

module.exports = {
  reducer,
  // Actions
  fetchServiceStatus
};
