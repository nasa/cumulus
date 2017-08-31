'use strict';
const expect = require('expect.js');

const allSuccessFixture = require('./fixtures/all-success-fixture');
const missingFileFixture = require('./fixtures/missing-file-fixture');

const timeStamp = (dateTime) => dateTime.toISOString().replace(/\.\d\d\dZ/, 'Z');

xdescribe('validate-archives.handler', () => {
  let result;
  let input;
  let timeStampStr;

});

