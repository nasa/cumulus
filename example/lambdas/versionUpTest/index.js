'use strict';

// Function that returns constant text string.  Used for testing lambda modification.
function handler(event, context, callback) {
  const eventCopy = event;
  eventCopy.payload = { output: 'Current Version' };
  callback(null, event);
}

exports.handler = handler;
