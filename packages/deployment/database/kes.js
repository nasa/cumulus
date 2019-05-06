/**
 * This module overrides the Kes Class
 * to support specific needs of the Cumulus Deployment.
 *
 * Specifically, this module changes the default Kes Deployment in the following ways:
 *
 * - Adds checking for this.config.params.db and using it for cloudFormation parameters
 *   intended for the db deployment
 *
 */

'use strict';

const { Kes } = require('kes');

/**
 * A subclass of Kes class that overrides cloudFormation method
 *
 * @class UpdatedKes
 */
class UpdatedKes extends Kes {
  /**
   * Calls CloudFormation's update-stack or create-stack methods
   * Changed to support multi-template configs by checking for params sub-objects, i.e.:
   * params:
   *   db:
   *     - name: someName
   *       value: someValue
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  cloudFormation() {
    if (!Array.isArray(this.config.params)) {
      if (this.config.params.db) this.config.params = this.config.params.db;
      else this.config.params = [];
    }
    return super.cloudFormation();
  }
}

module.exports = UpdatedKes;
