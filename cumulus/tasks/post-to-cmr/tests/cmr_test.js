'use strict';

import test from 'ava';
import sinon from 'sinon';
import { S3 } from 'cumulus-common/aws-helpers';
import cmrjs from 'cumulus-common/cmrjs';
import { handler } from '../index';
import payload from '../../../test_data/payloads/payload_ast_l1a.json';

const result = {
  'concept-id': 'testingtesging'
};

const granuleId = '1A0000-2016111101_000_001';
const collectionName = 'AST_L1A';

test.before(() => {
  sinon.stub(S3, 'get').callsFake(() => ({ Body: '<xml></xml>' }));
  sinon.stub(cmrjs, 'ingestGranule').callsFake(() => ({
    result
  }));
});

test.cb('should succeed with correct payload', (t) => {
  t.is(payload.meta.granules[granuleId].published, false);
  handler(payload, {}, (e, r) => {
    t.is(e, null);
    t.is(
      r.meta.granules[granuleId].cmrLink,
      `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
    );
    t.is(r.meta.granules[granuleId].published, true);
    t.end(e);
  });
});

test.cb('Should skip cmr step if the metadata file uri is missing', (t) => {
  const newPayload = Object.assign({}, payload);
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
  cmrjs.ingestGranule.restore();
});
