'use strict';

const Task = require('@cumulus/common/task');

/**
 * Task that filers its input payload to generate a new payload based on its configuration
 * Input payload: An object with the keys given in the output_keys configuration parameter and
 * possibly others.
 * Output payload: An object containing the keys given in the output_keys configuration parameter.
 */
module.exports = class FilterPayload extends Task {

  /**
   *  Returns a subset of the given `payload` determined by the keys given in `outputKeys`
   * @param {Object} payload The message payload
   * @param {Array} outputKeys The keys to preserve from the payload
   */
  static filterPayload(payload, outputKeys) {
    const newPayload = Object.keys(payload)
    .filter(key => outputKeys.includes(key))
    .reduce((obj, key) => {
      obj[key] = payload[key];
      return obj;
    }, {});

    return newPayload;
  }

  /**
   * Main task entry point
   * @return {Object} An object that contains a subset of the keys/values of the message payload
   */
  async run() {
    const message = this.message;
    const payload = await message.payload;
    const outputKeys = this.config.output_keys;

    return FilterPayload.filterPayload(payload, outputKeys);
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return FilterPayload.handle(...args);
  }
};
