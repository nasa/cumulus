'use strict';

const test = require('ava');

const {
  getMessagePdr,
  getMessagePdrPANSent,
  getMessagePdrPANMessage,
} = require('../PDRs');

test('getMessagePdr returns correct PDR object', (t) => {
  const pdr = {
    foo: 'bar',
  };
  t.deepEqual(getMessagePdr({
    payload: {
      pdr,
    },
  }), pdr);
});

test('getMessagePdr returns undefined if there is no PDR', (t) => {
  t.is(getMessagePdr({
    payload: {},
  }), undefined);
});

test('getMessagePdrPANSent returns correct value', (t) => {
  t.true(getMessagePdrPANSent({
    payload: {
      pdr: {
        PANSent: true,
      },
    },
  }));
  t.false(getMessagePdrPANSent({
    payload: {
      pdr: {
        PANSent: false,
      },
    },
  }));
});

test('getMessagePdrPANSent returns false if there is no PANsent value', (t) => {
  t.false(getMessagePdrPANSent({
    payload: {
      pdr: {},
    },
  }));
});

test('getMessagePdrPANMessage returns correct value', (t) => {
  const PANmessage = 'message';
  t.is(getMessagePdrPANMessage({
    payload: {
      pdr: {
        PANmessage,
      },
    },
  }), PANmessage);
});

test('getMessagePdrPANMessage returns "N/A" if there is no PANMessage value', (t) => {
  t.is(getMessagePdrPANMessage({
    payload: {
      pdr: {},
    },
  }), 'N/A');
});
