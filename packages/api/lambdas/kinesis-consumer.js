/* eslint-disable require-yield */
'use strict';

function handler(event, context, cb) {
  // it('should look up a "subscription" rule for the collection in the message')
  // it('should create a one-time rule for every associated rule with the correct workflow')
  console.log(event);
  return event;
}

module.exports = handler;
