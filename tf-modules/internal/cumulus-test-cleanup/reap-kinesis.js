/* eslint-disable import/no-unresolved */

'use strict';

// handy script to delete any old test kinesis streams that are created but not
// cleaned up.

const moment = require('moment');
const { Kinesis } = require('@aws-sdk/client-kinesis');
const { LimitExceededException } = require('@cumulus/aws-client/APIGateway');

const kinesis = new Kinesis();
const deleteOlderThanDays = 1;

function getStreams() {
  return kinesis.listStreams({})
    .then((result) => result.StreamNames);
}

function filterOld(streams) {
  const matcher = /(Error|Trigger|SourceTest|KinesisReplayTest)-(\d{13})-(Kinesis|Lambda|Replay)/;
  const results = streams.map((s) => {
    if (s.match(matcher)) {
      const streamDate = Number(s.match(matcher)[2]);
      if (moment().diff(streamDate, 'days') > deleteOlderThanDays) {
        return s;
      }
    }
    return undefined;
  });
  return results.filter((r) => r);
}

/** stagger retries from 25 to 30 seconds */
function randomInterval() {
  return Math.floor(Math.random() * 5000 + 25000);
}

async function nukeStream(streamName) {
  console.log(`nuking: ${streamName}`);
  try {
    return await kinesis.deleteStream({ StreamName: streamName });
  } catch (error) {
    if (error instanceof LimitExceededException) {
      const delay = randomInterval();
      console.log(`Limit exceeded...waiting ${delay / 1000} seconds and retrying to delete ${streamName}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return await nukeStream(streamName);
    }
    throw error;
  }
}

async function nukeStreams(listStreams) {
  console.log(`deleting ${listStreams.length} streams...`);
  return await Promise.all(listStreams.map((s) => nukeStream(s)));
}

async function runReaper() {
  return await getStreams()
    .then(filterOld)
    .then(nukeStreams);
}

module.exports = {
  runReaper,
};
