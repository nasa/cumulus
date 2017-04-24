/**
 * Provides an action and reducer for tracking the API Health.
 */
const { Map } = require('immutable');
const api = require('../ops-api');

const API_HEALTH_IN_FLIGHT = 'API_HEALTH_IN_FLIGHT';
const API_HEALTH_RCVD = 'API_HEALTH_RCVD';
const initialState = Map({ healthy: undefined, inFlight: false, error: undefined });

const reducer = (state = initialState, action) => {
  switch (action.type) {
    case API_HEALTH_IN_FLIGHT:
      return state.set('inFlight', true);
    case API_HEALTH_RCVD:
      return state.set('healthy', action.healthy)
        .set('inFlight', false)
        .set('error', action.error);
    default:
      return state;
  }
};


/**
 * fetchApiHealth - An action creator that initiates a request to get the health of the API.
 *
 * @param  config   Application configuration
 * @param  dispatch Function to dispatch a change to update the store.
 */
function fetchApiHealth(config, dispatch) {
  dispatch({ type: API_HEALTH_IN_FLIGHT });
  api.getApiHealth(config)
  .then((resp) => {
    dispatch({ type: API_HEALTH_RCVD, healthy: resp['ok?'] });
  })
  .catch((err) => {
    dispatch({ type: API_HEALTH_RCVD, healthy: false, error: err.message });
  });
}

module.exports = {
  reducer,
  fetchApiHealth
};
