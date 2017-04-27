// Reducers/actions
import { combineReducers } from 'redux-immutable';
import { reducer as apiHealth } from './reducers/api-health';
import { reducer as workflowStatus } from './reducers/workflow-status';

const { config } = require('./config');

const reducerCombiner = combineReducers({
  config: currConfig => currConfig || config,
  apiHealth,
  workflowStatus
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
