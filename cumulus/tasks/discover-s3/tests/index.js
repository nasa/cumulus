'use strict';

import test from 'ava';
import path from 'path';
import sinon from 'sinon';
import {
  ProviderNotFound,
  FTPError,
  RemoteResourceError
} from '@cumulus/common/errors';
import { S3 } from '@cumulus/ingest/aws';
import log from '@cumulus/common/log';
import input from './fixtures/input.json';
import { handler } from '../index';

test.cb('error when required input is missing', (t) => {
  console.log('input', input)
  const newPayload = Object.assign({}, input);

});
