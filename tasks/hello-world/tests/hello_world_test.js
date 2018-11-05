'use strict';

const test = require('ava');
const HelloWorld = require('../index');


test('Test return value from Hello World Task', async (t) => {
  const event = {
    config: {},
    input: {}
  };
  const data = await HelloWorld.helloWorld(event);

  t.is(data.hello, 'Hello World');
});
