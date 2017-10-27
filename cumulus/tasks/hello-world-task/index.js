'use strict';

const Task = require('@cumulus/common/task');

module.exports = class HelloWorld extends Task {
  /**
   * Main task entrypoint
   * @return A payload suitable for syncing via http url sync
   */
  async run() {
    return { hello: "Hello World" };
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

/*
*Another example without using Task Class
module.exports.handler = function handler(_event, context, cb) {
  return cb(null, "Hello World");
}
*/
