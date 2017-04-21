

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
      return state.set('healthy', action.healthy).set('inFlight', false);
    default:
      return state;
  }
};

async function getApiHealth(_config) {
  return rp({ uri: 'http://localhost:3000/health', json: true });
}

// getApiHealth(null).then(result => console.log(`Result ${JSON.stringify(result)}`)).catch(err => console.log(`Error ${err}`));

// const getApiHealth = async (_config) => {
//   return null;
// };

// let r;
// let e;
// rp({ uri: 'http://localhost:3000/health', json: true })
//   .then(result => r = result)
//   .catch(err => e = err);
//
// r;
// e;


// TODO tests like this
// reducer(reducer(undefined, {type: API_HEALTH_IN_FLIGHT}),
//   {type: API_HEALTH_RCVD, healthy: false});

module.exports = {
  reducer,
  getApiHealth,
};
