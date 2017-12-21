'use strict';

import test from 'ava';
import sinon from 'sinon';
import { StepFunction } from '@cumulus/ingest/aws';
import { IncompleteError } from '@cumulus/common/errors';
import { handler } from '../index';

test.cb('finished pdr status returns immediately', (t) => {
  sinon.stub(StepFunction, 'pullEvent').returns(Promise.resolve({
    payload: {
      pdr: { name: 'finished' },
      isFinished: true
    }
  }));

  const input = { s3_path: 'test', payload: {} };

  handler(input, {}, (e, output) => {
    t.ifError(e);
    t.is(typeof output, 'object');
    t.true(output.payload.isFinished);
    StepFunction.pullEvent.restore();
    t.end();
  });
});

test.cb('catch counter over limit error', (t) => {
  sinon.stub(StepFunction, 'pullEvent').returns(Promise.resolve({
    payload: {
      pdr: { name: 'over limit' },
      limit: 1,
      counter: 1
    }
  }));

  const input = { s3_path: 'test', payload: {} };

  handler(input, {}, (e) => {
    t.true(e instanceof IncompleteError);
    StepFunction.pullEvent.restore();
    t.end();
  });
});

test.cb('check running executions', (t) => {
  sinon.stub(StepFunction, 'pullEvent').returns(Promise.resolve({
    payload: {
      pdr: { name: 'completed' },
      running: ['1']
    }
  }));

  sinon.stub(StepFunction, 'getExecution')
    .returns(Promise.resolve([{
      status: 'SUCCEEDED'
    }]));

  const input = { s3_path: 'test', payload: {} };

  handler(input, {}, (e, output) => {
    t.ifError(e);
    t.is(typeof output, 'object');
    t.is(output.payload.completed, 1);
    t.true(output.payload.isFinished);
    StepFunction.pullEvent.restore();
    t.end();
  });
});
