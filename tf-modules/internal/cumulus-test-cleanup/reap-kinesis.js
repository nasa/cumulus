/* eslint-disable import/no-unresolved */

'use strict';

// handy script to delete any old test kinesis streams that are created but not
// cleaned up.

const aws = require('aws-sdk');
const moment = require('moment');
const kinesis = new aws.Kinesis();

const deleteOlderThanDays = 1;

function getStreams() {
  return kinesis.listStreams({})
    .promise()
    .then((result) => result.StreamNames);
}

function filterOld(streams) {
  const matcher = /(Error|Trigger|SourceTest)-(\d{13})-(Kinesis|Lambda)/;
  const results = streams.map((s) => {
    if (s.match(matcher)) {
      const streamDate = Number(s.match(matcher)[2]);
      if (moment().diff(streamDate, 'days') > deleteOlderThanDays) {
        return s;
      }
    }

    return null;
  });
  return results.filter((r) => r);
}

function nukeStream(streamName) {
  console.log(`nuking: ${streamName}`);
  return kinesis.deleteStream({ StreamName: streamName }).promise();
}

async function nukeStreams(listStreams) {
  // do in serial because of aws limits
  listStreams.forEach(async (s) => {
    await nukeStream(s);
  });
}

function runReaper() {
  return getStreams()
    .then(filterOld)
    .then(nukeStreams);
}

module.exports = {
  runReaper
};
