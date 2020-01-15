'use strict';
// handy script to delete any old test kinesis streams that are created but not
// cleaned up.

const aws = require('aws-sdk');
const moment = require('moment');
const kinesis = new aws.Kinesis();

const deleteOlderThanDays = 1;

const getStreams = async () => {
  return kinesis.listStreams({})
    .promise()
    .then((result) => result.StreamNames);
};


const filterOld = (streams) => {
  const matcher = /(Error|Trigger|SourceTest)-([0-9]{13})-(Kinesis|Lambda)/;
  const results = streams.map((s) => {
    if (s.match(matcher)) {
      const streamDate = Number(s.match(matcher)[2]);
      if (moment(new Date()).diff(streamDate, 'days') > deleteOlderThanDays) {
        return s;
      }
    }
  });
  return results.filter(r => r);
};

const nukeStream = async (StreamName) => {
  console.log(`nuking: ${StreamName}`);
  return kinesis.deleteStream({StreamName}).promise();
};

const nukeStreams = async (listStreams) => {
  // do in serial because of aws limits
  for (const s of listStreams) {
    await nukeStream(s);
  };
};

const runReaper = () => {
  return getStreams()
    .then(filterOld)
    .then(nukeStreams);
};

runReaper();
