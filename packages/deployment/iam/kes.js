/**
 * This module overrides the Kes Class
 * to support specific needs of the Cumulus Deployment.
 *
 * Specifically, this module changes the default Kes Deployment in the following ways:
 *
 * - Adds a custom handlebar helper for filtering buckets of a certain type
 * - Adds checking for this.config.params.iam and using it for cloudFormation parameters
 *   intended for the iam deployment
 *
 */

'use strict';

const { Kes } = require('kes');
const Handlebars = require('handlebars');

/**
 * A subclass of Kes class that overrides parseCF and cloudFormation methods
 *
 * @class UpdatedKes
 */
class UpdatedKes extends Kes {
  /**
   * Overrides the default constructor.
   * Sets the cf_template_name to have a prefix.
   *
   * @param {Object} config - kes config object
   */
  constructor(config) {
    super(config);
    this.cf_template_name = `iam.${this.cf_template_name}`;
    this.templateUrl = `https://s3.amazonaws.com/${this.bucket}/${this.stack}/${this.cf_template_name}`;
  }

  parseCF(cfFile) {
    Handlebars.registerHelper('BucketIsType', (bucket, type, options) => {
      const fnTrue = options.fn;
      const fnFalse = options.inverse;
      const types = type.split(',');

      if (types.includes(bucket.type)) return fnTrue(bucket);

      return fnFalse(bucket);
    });

    return super.parseCF(cfFile);
  }

  /**
   * Calls CloudFormation's update-stack or create-stack methods
   * Changed to support multi-template configs by checking for params sub-objects, i.e.:
   * params:
   *   iam:
   *     - name: someName
   *       value: someValue
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  cloudFormation() {
    if (this.config.iam && this.config.iam.params) this.config.params = this.config.iam.params;
    return super.cloudFormation();
  }
}

module.exports = UpdatedKes;
