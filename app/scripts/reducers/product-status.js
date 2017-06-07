/**
 * Handles fetching and saving the product status in the state.
 */
const { Map, Set } = require('immutable');
const api = require('../ops-api');

// Actions
const PRODUCT_STATUS_IN_FLIGHT = 'PRODUCT_STATUS_IN_FLIGHT';
const PRODUCT_STATUS_RCVD = 'PRODUCT_STATUS_RCVD';
const REINGEST_GRANULE_COMPLETED = 'REINGEST_GRANULE_COMPLETED';
const REINGEST_GRANULE_FAILED = 'REINGEST_GRANULE_FAILED';
const REINGEST_GRANULE_IN_FLIGHT = 'REINGEST_GRANULE_IN_FLIGHT';

const initialState = Map({
  productStatus: undefined,
  workflowId: undefined,
  collectionId: undefined,
  inFlight: false,
  error: undefined,
  reingest: Map({
    startingGranules: Set(),
    startedGranules: Set()
  })
});

/**
 * Main reducer function for workflow status state.
 */
const reducer = (state = initialState, action) => {
  let updatedState;

  switch (action.type) {
    case PRODUCT_STATUS_IN_FLIGHT:
      updatedState = state.set('inFlight', true);
      if (action.workflowId !== state.get('workflowId')
        || action.collectionId !== state.get('collectionId')) {
        // The workflow or collection has changed. Set productStatus to null so we
        updatedState = updatedState.set('productStatus', null)
          .set('workflowId', action.workflowId)
          .set('collectionId', action.collectionId);
      }
      return updatedState;
    case PRODUCT_STATUS_RCVD:
      return state.set('productStatus', action.productStatus)
        .set('inFlight', false)
        .set('error', action.error);
    case REINGEST_GRANULE_IN_FLIGHT:
      return state.updateIn(['reingest', 'startingGranules'], items => items.add(action.granuleId));
    case REINGEST_GRANULE_COMPLETED:
      return state.updateIn(['reingest', 'startedGranules'], items => items.add(action.granuleId))
        .updateIn(['reingest', 'startingGranules'], items => items.remove(action.granuleId));
    case REINGEST_GRANULE_FAILED:
      // TODO we should change state.error to errors and add it. That should be displayed at the top
      // of the page
      return state;
    default:
      return state;
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////////
// Actions

/**
 * fetchProductStatus - An action creator that initiates a request to fetch the workflow status
 *
 * @param  config   Application configuration
 * @param  dispatch Function to dispatch a change to update the store.
 */
const fetchProductStatus = async (config, workflowId, collectionId, dispatch) => {
  dispatch({ type: PRODUCT_STATUS_IN_FLIGHT, workflowId, collectionId });
  try {
    const resp = await api.getProductStatus(config, workflowId, collectionId);
    dispatch({ type: PRODUCT_STATUS_RCVD, productStatus: resp, workflowId, collectionId });
  }
  catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    dispatch({ type: PRODUCT_STATUS_RCVD, error: e.message });
  }
};

const reingestGranule = async (config, collectionId, granuleId, dispatch) => {
  console.log(`Starting granule reingest of ${granuleId}`);
  // dispatch something to show it's in progress
  dispatch({ type: REINGEST_GRANULE_IN_FLIGHT, collectionId, granuleId });
  try {
    const executionName = await api.reingestGranule(config, collectionId, granuleId);
    console.log(`Granule ${granuleId} reingest succesfully started`);
    dispatch({ type: REINGEST_GRANULE_COMPLETED, executionName, collectionId, granuleId });
  }
  catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    // TODO Put a better more user friendly error message in for display.
    dispatch({ type: REINGEST_GRANULE_FAILED, error: e.message });
  }
};

module.exports = {
  reducer,
  // Actions
  fetchProductStatus,
  reingestGranule
};
