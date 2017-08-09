'use strict';

import test from 'ava';
import sinon from 'sinon';
import { S3 } from '@cumulus/ingest/aws';
import cmrjs from '@cumulus/cmrjs';
import payload from '@cumulus/test-data/payloads/payload_ast_l1a.json';
import { handler } from '../index';

const result = {
  'concept-id': 'testingtesging'
};

const granuleId = '1A0000-2016111101_000_001';
const collectionName = 'AST_L1A';

test.before(() => {
  sinon.stub(S3, 'get').callsFake(() => ({ Body: '<xml></xml>' }));
});

test.cb.serial('should succeed if cmr correctly identifies the xml as invalid', (t) => {
  const newPayload = Object.assign({}, payload);
  t.is(newPayload.meta.granules[granuleId].published, false);
  handler(newPayload, {}, (e) => {
    t.true(e instanceof cmrjs.ValidationError);
    t.end();
  });
});

test.cb.serial('should succeed with correct payload', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  t.is(newPayload.meta.granules[granuleId].published, false);
  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));
  handler(newPayload, {}, (e, r) => {
    t.is(e, null);
    t.is(
      r.meta.granules[granuleId].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
    );
    t.is(r.meta.granules[granuleId].published, true);
    t.end(e);
    cmrjs.CMR.prototype.ingestGranule.restore();
  });
});

test.cb.serial('Should skip cmr step if the metadata file uri is missing', (t) => {
  const newPayload = Object.assign({}, payload);
  newPayload.meta.granules[granuleId].published = false;
  t.is(newPayload.meta.granules[granuleId].published, false);
  newPayload.payload.output[collectionName].granules[0].files['meta-xml'] = null;
  handler(newPayload, {}, (e, r) => {
    t.is(r.meta.granules[granuleId].published, false);
    t.end();
  });
});

// TODO: write tests for
//  - when metadata fails CMR validation
//  - when CMR is down
//  - when username/password is incorrect

test.after(() => {
  S3.get.restore();
});
