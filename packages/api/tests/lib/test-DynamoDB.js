// 'use strict';

const test = require('ava');
test('pass', (t) => t.pass());
const DynamoDB = require('../../lib/DynamoDB');

test('toDynamoItem() properly translates a string', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat('asdf'),
    { S: 'asdf' }
  );
});

test('toDynamoItem() properly translates an integer', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat(123),
    { N: '123' }
  );
});

test('toDynamoItem() properly translates a float', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat(123.45),
    { N: '123.45' }
  );
});

test('toDynamoItem() properly translates an array of strings', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat(['a', 'b', 'c']),
    { SS: ['a', 'b', 'c'] }
  );
});

test('toDynamoItem() properly translates an array of numbers', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat([1, 1.1, 2]),
    { NS: ['1', '1.1', '2'] }
  );
});

test('toDynamoItem() properly translates an object', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat({ a: 1, b: 'one' }),
    {
      M: {
        a: { N: '1' },
        b: { S: 'one' }
      }
    }
  );
});

test('toDynamoItem() properly translates an array', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat([1, 'a']),
    {
      L: [
        { N: '1' },
        { S: 'a' }
      ]
    }
  );
});

test('toDynamoItem() properly translates a boolean value', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat(true),
    { BOOL: true }
  );
});

test('toDynamoItem() properly translates a null value', (t) => {
  t.deepEqual(
    DynamoDB.toDynamoItemFormat(null),
    { NULL: true }
  );
});
