'use strict';

const test = require('ava');
const log = require('../log');
const spawn = require('child_process').spawn;
const readline = require('readline');

test('prints out logs', (t) => {
  process.env.SENDER = 'sender';
  process.env.EXECUTIONS = 'executions';

  const expectedOutput = {
    level: 'info',
    executions: 'executions',
    timestamp: 'some time',
    sender: 'sender',
    message: 'Some output'
  };


  log.info('Some output');

  console.log('Something first');
  let theOutput;
  const rl = readline.createInterface({
    input: process.stdout
  });
  t.is(undefined);
  console.log('Second');

  rl.on('line', (line) => {
    console.log('reading th eline', line);
    theOutput += line;
  });

  rl.close();

  console.log('The output: ', rl.output);
  console.log('The end.');
});
