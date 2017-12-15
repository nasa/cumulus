'use strict';

import test from 'ava';
import path from 'path';
import fs from 'fs';
import sinon from 'sinon';
import AWS from 'aws-sdk';
import {
  ProviderNotFound,
  FTPError,
  RemoteResourceError
} from '@cumulus/common/errors';
import { S3, SQS } from '@cumulus/ingest/aws';
import log from '@cumulus/common/log';
import { handler } from '../index';
import inputJSON from './fixtures/input.json';
import workflowMessageJSON from './fixtures/workflow-template.json';

test.cb('queue pdrs', (t) => {
  sinon.stub(S3, 'fileExists').callsFake(() => false);
  sinon.stub(SQS, 'sendMessage').returns(new Promise((resolve, reject) => resolve()));

  const input = Object.assign({}, inputJSON);
  const message = fs.readFileSync(path.join(__dirname, 'fixtures', 'workflow-template.json'), 'utf8');

  sinon.stub(S3, 'get').returns(new Promise((resolve, reject) => {
    return resolve({
      Body: message
    });
  }));

  handler(input, {}, (e, output) => {
    if (e && e.message.includes('getaddrinfo ENOTFOUND')) {
      log.info('ignoring this test. Test server seems to be down');
    }

    t.ifError(e);
    t.is(typeof output, 'object');
    t.is(output.pdrs_queued, 2);

    S3.fileExists.restore();
    S3.get.restore();
    SQS.sendMessage.restore();
    t.end();
  });
});
