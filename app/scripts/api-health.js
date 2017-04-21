

// TODO comment file
const { Map } = require('immutable');
const rp = require('request-promise');

const API_HEALTH_IN_FLIGHT = 'API_HEALTH_IN_FLIGHT';
const API_HEALTH_RCVD = 'API_HEALTH_RCVD';
const initialState = Map({ healthy: undefined, inFlight: false, error: undefined });

/**
 * TODO define reducer
 */
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

function getApiHealth(config, dispatch) {
  dispatch({ type: API_HEALTH_IN_FLIGHT });
  rp({ uri: `${config.apiBaseUrl}/health`, json: true })
  .then((resp) => {
    dispatch({ type: API_HEALTH_RCVD, healthy: resp['ok?'] });
  })
  .catch((err) => {
    dispatch({ type: API_HEALTH_RCVD, healthy: false, error: err.message });
  });
}

// TODO tests for this stuff

module.exports = {
  reducer,
  getApiHealth,
};
