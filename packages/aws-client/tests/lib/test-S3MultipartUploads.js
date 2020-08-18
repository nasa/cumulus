'use strict';

const test = require('ava');
const { createMultipartChunks } = require('../../lib/S3MultipartUploads');

test('createMultipartChunks(0) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(0),
    []
  );
});

test('createMultipartChunks(9, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(9, 10),
    [
      { start: 0, end: 8 },
    ]
  );
});

test('createMultipartChunks(10, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(10, 10),
    [
      { start: 0, end: 9 },
    ]
  );
});

test('createMultipartChunks(11, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(11, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 10 },
    ]
  );
});

test('createMultipartChunks(12, 10) returns the correct chunks', (t) => {
  t.deepEqual(
    createMultipartChunks(12, 10),
    [
      { start: 0, end: 9 },
      { start: 10, end: 11 },
    ]
  );
});
