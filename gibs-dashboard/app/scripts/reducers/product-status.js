/**
 * Handles fetching and saving the product status in the state.
 */
const { Map, Set } = require('immutable');
const api = require('../ops-api');
const { errorAction } = require('./errors');

// Actions
const PRODUCT_STATUS_IN_FLIGHT = 'PRODUCT_STATUS_IN_FLIGHT';
const PRODUCT_STATUS_RCVD = 'PRODUCT_STATUS_RCVD';
const REINGEST_GRANULE_COMPLETED = 'REINGEST_GRANULE_COMPLETED';
const REINGEST_GRANULE_IN_FLIGHT = 'REINGEST_GRANULE_IN_FLIGHT';

const reingestInitialState = Map({
  startingGranules: Set(),
  startedGranules: Set()
});

const initialState = Map({
  productStatus: undefined,
  workflowId: undefined,
  collectionId: undefined,
  inFlight: false,
  reingest: reingestInitialState
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
        updatedState = updatedState
          .set('productStatus', null)
          .set('workflowId', action.workflowId)
          .set('collectionId', action.collectionId);
      }
      return updatedState;
    case PRODUCT_STATUS_RCVD:
      return state
        .set('productStatus', action.productStatus)
        // Later: This causes problems in that the state on the GUI too quickly disappears when we
        // do an auto refresh. It loses track of the fact that granule reingests were started
        // // Reset the reingest state that tracks reingests that were started.
        // .set('reingest', reingestInitialState)
        .set('inFlight', false);
    case REINGEST_GRANULE_IN_FLIGHT:
      return state
        .updateIn(['reingest', 'startingGranules'], items => items.add(action.granuleId));
    case REINGEST_GRANULE_COMPLETED:
      return state
        .updateIn(['reingest', 'startedGranules'], items => items.add(action.granuleId))
        .updateIn(['reingest', 'startingGranules'], items => items.remove(action.granuleId));
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
    dispatch(
      errorAction(`An unexpected error occurred attempting to fetch product status. ${e.message}`));
  }
};

const reingestGranule = async (config, workflowId, collectionId, granuleId, dispatch) => {
  // dispatch something to show it's in progress
  dispatch({ type: REINGEST_GRANULE_IN_FLIGHT, collectionId, granuleId });
  try {
    const executionName = await api.reingestGranule(config, collectionId, granuleId);
    dispatch({ type: REINGEST_GRANULE_COMPLETED, executionName, collectionId, granuleId });

    // Refresh product status to show running workflows
    fetchProductStatus(config, workflowId, collectionId, dispatch);
  }
  catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    dispatch(
      errorAction(`An unexpected error occurred attempting to reingest the granule. ${e.message}`));
  }
};

module.exports = {
  reducer,
  // Actions
  fetchProductStatus,
  reingestGranule
};
