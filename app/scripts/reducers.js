// Reducers/actions
const { combineReducers } = require('redux-immutable');
const apiHealth = require('./reducers/api-health').reducer;
const workflowStatus = require('./reducers/workflow-status').reducer;
const serviceStatus = require('./reducers/service-status').reducer;

const { config } = require('./config');

const reducerCombiner = combineReducers({
  config: currConfig => currConfig || config,
  apiHealth,
  workflowStatus,
  serviceStatus
});

export default (state, action) => {
  let newState = state;
  // If the location changes we'll check for whether the use of canned data is configured or not.
  if (action.type === '@@router/LOCATION_CHANGE') {
    newState = newState.setIn(['config', 'useCannedData'],
      action.payload.search.includes('use-canned-data'));
  }
  return reducerCombiner(newState, action);
};
