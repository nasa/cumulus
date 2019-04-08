/**
 * This module overrides the Kes Class
 * to support specific needs of the Cumulus Deployment.
 *
 * Specifically, this module changes the default Kes Deployment in the following ways:
 *
 * - Adds a custom handlebar helper for filtering buckets of a certain type
 *
 */

'use strict';

const { Kes } = require('kes');
const Handlebars = require('handlebars');

/**
 * A subclass of Kes class that overrides parseCF method
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
}

module.exports = UpdatedKes;
