const local = require('./local-helpers');
const eventSource = require('./event-source');
const log = require('./log');

/**
 * TODO Add docs
 */
exports.collectionEventInput = (id) =>
  local.collectionEventInput(id)();

const testEventSource = () => {
  const events = [];

  const TestSource = class extends eventSource.EventSource {
    constructor(event) {
      super();
      this.eventData = event;
      if (event && event.transaction) {
        this.key = event.transaction.key;
      }
    }

    getEventScopedJson() {
      return Promise.resolve(null);
    }

    trigger(eventName, key, data) {
      events.push([eventName, key, data]);
    }

    loadState() {
      return this.eventData && this.eventData.state;
    }

    static isSourceFor() {
      return true;
    }
  };
  TestSource.events = events;
  return TestSource;
};

/**
 * TODO Add docs
 */
exports.run = async (TaskClass, input) => {
  const TestSource = testEventSource();
  eventSource.eventSources.unshift(TestSource);
  log.mute('info', 'log', 'debug');
  try {
    await TaskClass.handler(input, {}, () => null);
  }
  finally {
    eventSource.eventSources.shift();
    log.unmute();
  }
  return TestSource.events;
};
