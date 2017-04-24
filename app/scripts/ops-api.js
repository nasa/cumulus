/**
 * Provides functions for accessing the GIBS Ops API.
 */

 const rp = require('request-promise');

 /**
  * getApiHealth - Gets the health of the Ops API
  *
  * @param  config APP configuration
  * @return A promise delivering the health.
  */
 function getApiHealth(config) {
   return rp({ uri: `${config.apiBaseUrl}/health`, json: true });
 }

 /**
  * getProductStatus - Fetches the list of product status details.
  *
  * @param  config APP configuration
  * @return A promise delivering the list of product statuses.
  */
 function getProductStatus(config) {
   return rp({ uri: `${config.apiBaseUrl}/product_status`, json: true });
 }

 module.exports = {
   getApiHealth,
   getProductStatus
 };
