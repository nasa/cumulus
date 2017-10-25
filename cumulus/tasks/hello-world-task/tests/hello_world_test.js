'use strict';
const test = require('ava');
const helpers = require('@cumulus/common/test-helpers');
import { handler } from '../index';


test('TODO - add test using Task class', t => {
  t.is(1,1);
});


/*
test.cb('Tests response from Handler', t => {
  handler({}, {}, (err, data)=> {
    t.is(err, null);
    t.is(data.hello, "Hello World");
    t.end();
  });
});
*/