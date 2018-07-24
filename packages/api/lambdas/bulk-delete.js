'use strict';

// This is just a mock BulkDelete Lambda function intended to support
// development of the AsynchronousOperation functionality.

async function handler(event, _context, _cb) {
  if (!event.granuleIds) throw new TypeError('event.granuleIds is required');

  if (event.granuleIds.includes('trigger-failure')) {
    throw new Error('triggered failure');
  }
  return { deletedGranules: event.granuleIds };
}
exports.handler = handler;
