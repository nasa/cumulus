'use strict';

const Task = require('@cumulus/common/task');

/**
 * Task that filers its input payload to generate a new payload based on its configuration
 * Input payload: An object with the keys given in the output_keys configuration parameter and
 * possibly others.
 * Output payload: The value of the keys given in the output_keys configuration parameter.
 */
module.exports = class FilterPayload extends Task {

  /**
   * Main task entry point
   * @return Any An object/array, etc., that consists of the value of given key in the
   * message payload
   */
  async run() {
    const message = this.message;
    const payload = await message.payload;
    const outputKey = this.config.output_key;

    return payload[outputKey];
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
