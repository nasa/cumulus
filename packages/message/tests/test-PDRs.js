'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

const {
  getMessagePdr,
  messageHasPdr,
  getMessagePdrPANSent,
  getMessagePdrPANMessage,
  getMessagePdrRunningExecutions,
  getMessagePdrCompletedExecutions,
  getMessagePdrFailedExecutions,
  getMessagePdrStats,
  getPdrPercentCompletion,
} = require('../PDRs');

test.beforeEach((t) => {
  t.context.pdr = {
    name: `pdr${cryptoRandomString({ length: 5 })}`,
    PANSent: true,
    PANmessage: 'message',
  };
});

test('getMessagePdr returns correct PDR object', (t) => {
  const { pdr } = t.context;
  t.deepEqual(
    getMessagePdr({
      payload: {
        pdr,
      },
    }),
    pdr
  );
});

test('getMessagePdr returns undefined if there is no PDR', (t) => {
  t.is(getMessagePdr({
    payload: {},
  }), undefined);
});

test('messageHasPdr correctly returns true if there is a PDR', (t) => {
  const { pdr } = t.context;
  t.true(messageHasPdr({
    payload: {
      pdr,
    },
  }));
});

test('messageHasPdr correct returns false if there is no PDR', (t) => {
  t.false(messageHasPdr({
    payload: {},
  }));
});

test('getMessagePdrPANSent returns correct value', (t) => {
  const { pdr } = t.context;
  pdr.PANSent = true;
  t.true(getMessagePdrPANSent({
    payload: {
      pdr: {
        PANSent: true,
      },
    },
  }));
  pdr.PANSent = false;
  t.false(getMessagePdrPANSent({
    payload: {
      pdr,
    },
  }));
});

test('getMessagePdrPANSent returns false if there is no PANsent value', (t) => {
  t.false(getMessagePdrPANSent({}));
});

test('getMessagePdrPANMessage returns correct value', (t) => {
  const { pdr } = t.context;
  t.is(getMessagePdrPANMessage({
    payload: {
      pdr,
    },
  }), pdr.PANmessage);
});

test('getMessagePdrPANMessage returns "N/A" if there is no PANMessage value', (t) => {
  t.is(getMessagePdrPANMessage({}), 'N/A');
});

test('getMessagePdrRunningExecutions returns correct number of executions', (t) => {
  const { pdr } = t.context;
  t.is(
    getMessagePdrRunningExecutions({
      payload: {
        pdr,
        running: ['one', 'two', 'three'],
      },
    }),
    3
  );
});

test('getMessagePdrRunningExecutions returns 0 if there are no running executions', (t) => {
  const { pdr } = t.context;
  t.is(
    getMessagePdrRunningExecutions({
      payload: {
        pdr,
      },
    }),
    0
  );
});

test('getMessagePdrCompletedExecutions returns correct number of executions', (t) => {
  const { pdr } = t.context;
  t.is(
    getMessagePdrCompletedExecutions({
      payload: {
        pdr,
        completed: ['one'],
      },
    }),
    1
  );
});

test('getMessagePdrCompletedExecutions returns 0 if there are no completed executions', (t) => {
  const { pdr } = t.context;
  t.is(
    getMessagePdrCompletedExecutions({
      payload: {
        pdr,
      },
    }),
    0
  );
});

test('getMessagePdrFailedExecutions returns correct number of executions', (t) => {
  const { pdr } = t.context;
  t.is(
    getMessagePdrFailedExecutions({
      payload: {
        pdr,
        failed: ['one'],
      },
    }),
    1
  );
});

test('getMessagePdrFailedExecutions returns 0 if there are no failed executions', (t) => {
  const { pdr } = t.context;
  t.is(
    getMessagePdrFailedExecutions({
      payload: {
        pdr,
      },
    }),
    0
  );
});

test('getMessagePdrStats returns correct stats', (t) => {
  const { pdr } = t.context;
  t.deepEqual(
    getMessagePdrStats({
      pdr,
      payload: {
        running: ['one', 'two'],
        completed: ['three', 'four'],
        failed: ['five', 'six'],
      },
    }),
    {
      processing: 2,
      completed: 2,
      failed: 2,
      total: 6,
    }
  );
});

test('getPdrPercentCompletion returns correct percentage', (t) => {
  t.is(
    getPdrPercentCompletion({
      processing: 2,
      completed: 2,
      failed: 0,
      total: 4,
    }),
    50
  );
  t.is(
    getPdrPercentCompletion({
      processing: 6,
      completed: 2,
      failed: 2,
      total: 10,
    }),
    40
  );
  t.is(
    getPdrPercentCompletion({
      processing: 0,
      completed: 1,
      failed: 0,
      total: 1,
    }),
    100
  );
});
