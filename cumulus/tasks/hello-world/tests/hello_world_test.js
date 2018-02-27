'use strict';
const test = require('ava');
const HelloWorld = require('../index');


test('Test return value from Hello World Task', (t) => {
  const event = {};
  const data = HelloWorld.helloWorld(event);

  t.is(data.hello, 'Hello World');
});
