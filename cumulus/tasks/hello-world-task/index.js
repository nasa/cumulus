'use strict';

const Task = require('@cumulus/common/task');

/**
 * Input payload: None
 * Output payload: String
 */
module.exports = class HelloWorld extends Task {
  /**
   * Main task entrypoint
   * @return A payload suitable for syncing via http url sync
   */
  run() {
    return "Hello World";
  }

  /**
   * Entrypoint for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return HelloWorld.handle(...args);
  }
};
