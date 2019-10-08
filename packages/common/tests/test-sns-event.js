'use strict';

const test = require('ava');
const { getSnsEventMessageObject, isSnsEvent } = require('../sns-event');

test('isSnsEvent returns false for non-SNS events', (t) => {
  t.false(isSnsEvent({}));

  t.false(isSnsEvent({
    Sns: {}
  }));

  t.false(isSnsEvent({
    EventSource: 'aws:cloudwatch',
    CloudWatch: {
      Message: 'message'
    }
  }));

  t.false(isSnsEvent({
    Records: [{
      EventSource: 'aws:states',
      Sns: {
        Message: 'message'
      }
    }]
  }));

  t.false(isSnsEvent({
    EventSource: 'aws:states',
    States: {
      Message: JSON.stringify({
        cumulus_meta: {
          execution_name: 'exec123',
          state_machine: 'workflow123'
        },
        meta: {},
        payload: {}
      })
    }
  }));
});

test('getSnsEventMessageObject() returns default object', (t) => {
  const returnedObject = getSnsEventMessageObject({});
  t.deepEqual(returnedObject, {});
});

test('getSnsEventMessageObject() returns correct object', (t) => {
  const messageObject = {
    foo: 'bar',
    nested: {
      key: 'value'
    }
  };

  const returnedObject = getSnsEventMessageObject({
    Sns: {
      Message: JSON.stringify(messageObject)
    }
  });

  t.deepEqual(returnedObject, messageObject);
});

test('getSnsEventMessageObject() returns null for non-JSON string message', (t) => {
  const returnedObject = getSnsEventMessageObject({
    Sns: {
      Message: 'message'
    }
  });

  t.is(returnedObject, null);
});
