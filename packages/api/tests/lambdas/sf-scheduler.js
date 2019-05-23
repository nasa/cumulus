'use strict';

const rewire = require('rewire');
const test = require('ava');

const schedule = rewire('../../lambdas/sf-scheduler');

const queueName = 'dont talk to me';
const scheduleInput = {
  queueName
};

test.serial('Sends a message to SQS with queueName if queueName is defined', (t) => {
  schedule(scheduleInput);
});

test.serial('Sends a message to SQS with startSF if queueName is not defined', (t) => {
  schedule(scheduleInput);
});
