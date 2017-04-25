const local = require('./local-helpers');
const messageSource = require('./message-source');
const log = require('./log');

/**
 * Creates a collection input message for the given id by reading from local collections.yml
 * @param {string} id - The collection id in collections.yml
 * @return - The input message
 */
exports.collectionMessageInput = (id) =>
  local.collectionMessageInput(id)();

/**
 * An MessageSource instance suitable for tests, which mocks
 * MessageSource methods typically read from AWS calls
 */
class TestSource extends messageSource.MessageSource {
  /**
   * @param {object} message - The incoming message data
   */
  constructor(message) {
    super();
    this.messageData = message;
    if (message && message.meta) {
      this.key = message.meta.key;
    }
  }

  /**
   * @return - A promise resolving to null
   */
  getMessageScopedJson() {
    return Promise.resolve(null);
  }

  /**
   * @return The 'state' field of the message
   */
  loadState() {
    return this.messageData && this.messageData.state;
  }

  /**
   * @return - true
   */
  static isSourceFor() {
    return true;
  }
}

/**
 * Creates and runs ingest for an instance of the given Task class with the given input
 * @param {class} TaskClass - The Task class to create/run
 * @param {object} input - The input message to run the Task with
 * @return - The task return value
 */
exports.run = async (TaskClass, input) => {
  messageSource.messageSources.unshift(TestSource);
  log.mute('info', 'log', 'debug');
  try {
    return await TaskClass.handler(input, {}, () => null);
  }
  finally {
    messageSource.messageSources.shift();
    log.unmute();
  }
};
