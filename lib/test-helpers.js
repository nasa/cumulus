const local = require('./local-helpers');
const eventSource = require('./event-source');
const log = require('./log');

/**
 * Creates a collection input event for the given id by reading from local collections.yml
 * @param {string} id - The collection id in collections.yml
 * @return - The input event
 */
exports.collectionEventInput = (id) =>
  local.collectionEventInput(id)();

/**
 * An EventSource instance suitable for tests, which mocks
 * EventSource methods typically read from AWS calls
 */
class TestSource extends eventSource.EventSource {
  /**
   * @param {object} event - The incoming event data
   */
  constructor(event) {
    super();
    this.eventData = event;
    if (event && event.meta) {
      this.key = event.meta.key;
    }
  }

  /**
   * @return - A promise resolving to null
   */
  getEventScopedJson() {
    return Promise.resolve(null);
  }

  /**
   * @return The 'state' field of the event
   */
  loadState() {
    return this.eventData && this.eventData.state;
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
 * @param {object} input - The input event to run the Task with
 * @return - The task return value
 */
exports.run = async (TaskClass, input) => {
  eventSource.eventSources.unshift(TestSource);
  log.mute('info', 'log', 'debug');
  try {
    return await TaskClass.handler(input, {}, () => null);
  }
  finally {
    eventSource.eventSources.shift();
    log.unmute();
  }
};
