'use strict';

const test = require('ava');
const HelloWorld = require('..');


test('Test return value from Hello World Task', (t) => {
  const event = {
    config: {},
    input: {}
  };
  const data = HelloWorld.helloWorld(event);

  t.is(data.hello, 'Hello World');
});
