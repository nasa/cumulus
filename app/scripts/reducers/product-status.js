/**
 * Handles fetching and saving the product status in the state.
 */
const { Map } = require('immutable');
const api = require('../ops-api');

// Actions
const PRODUCT_STATUS_IN_FLIGHT = 'PRODUCT_STATUS_IN_FLIGHT';
const PRODUCT_STATUS_RCVD = 'PRODUCT_STATUS_RCVD';
const REINGEST_GRANULE_COMPLETED = 'REINGEST_GRANULE_COMPLETED';
const REINGEST_GRANULE_IN_FLIGHT = 'REINGEST_GRANULE_IN_FLIGHT';

const initialState = Map(
  { productStatus: undefined,
    workflowId: undefined,
    collectionId: undefined,
    inFlight: false,
    error: undefined });

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
      return state;
    case REINGEST_GRANULE_COMPLETED:
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

  // dispatch something to show it's in progress
  // TODO Show that we're reingesting
  dispatch({ type: REINGEST_GRANULE_IN_FLIGHT, collectionId, granuleId });
  try {
    const executionName = await api.reingestGranule(config, collectionId, granuleId);
    // TODO show somehow that its completed
    dispatch({ type: REINGEST_GRANULE_COMPLETED, executionName, collectionId, granuleId });
  }
  catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
    // TODO If there's an error display that in a header row.
    dispatch({ type: REINGEST_GRANULE_COMPLETED, error: e.message });
  }
  // TODO Refetch product status as well so the running execution shows up
};

module.exports = {
  reducer,
  // Actions
  fetchProductStatus,
  reingestGranule
};
