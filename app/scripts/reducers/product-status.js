/**
 * TODO
 */
const { Map, List, fromJS } = require('immutable');
const api = require('../ops-api');

const PRODUCT_STATUS_IN_FLIGHT = 'PRODUCT_STATUS_IN_FLIGHT';
const PRODUCT_STATUS_RCVD = 'PRODUCT_STATUS_RCVD';
const initialState = Map({ products: List(), inFlight: false, error: undefined });

const reducer = (state = initialState, action) => {
  switch (action.type) {
    case PRODUCT_STATUS_IN_FLIGHT:
      return state.set('inFlight', true);
    case PRODUCT_STATUS_RCVD:
      return state.set('products', fromJS(action.products))
        .set('inFlight', false)
        .set('error', action.error);
    default:
      return state;
  }
};

/**
 * fetchProductStatus - An action creator that initiates a request to fetch the product status
 *
 * @param  config   Application configuration
 * @param  dispatch Function to dispatch a change to update the store.
 */
function fetchProductStatus(config, dispatch) {
  dispatch({ type: PRODUCT_STATUS_IN_FLIGHT });
  api.getProductStatus(config)
  .then((resp) => {
    dispatch({ type: PRODUCT_STATUS_RCVD, products: resp });
  })
  .catch((err) => {
    dispatch({ type: PRODUCT_STATUS_RCVD, error: err.message });
  });
}

module.exports = {
  reducer,
  fetchProductStatus
};
