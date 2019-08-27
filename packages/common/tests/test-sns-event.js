'use strict';

const test = require('ava');
const { isSnsEvent } = require('../sns-event');

test('isSnsEvent returns false for non-SNS events', async (t) => {
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
