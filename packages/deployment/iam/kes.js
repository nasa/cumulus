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
 * A subclass of Kes class that overrides parseCF, compileCF and cloudFormation methods
 *
 * @class UpdatedKes
 */
class UpdatedKes extends Kes {
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
   * Compiles a CloudFormation template in Yaml format.
   *
   * Overridden to prepend `iam.` to output cloudformation yml file name.
   *
   * @returns {Promise} returns the promise of an AWS response object
   */
  compileCF() {
    const originalName = this.cf_template_name;
    this.cf_template_name = `iam.${originalName}`;
    return super.compileCF().then(() => {
      this.cf_template_name = originalName;
    });
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
    if (!Array.isArray(this.config.params)) {
      if (this.config.params.iam) this.config.params = this.config.params.iam;
      else this.config.params = [];
    }
    return super.cloudFormation();
  }
}

module.exports = UpdatedKes;
