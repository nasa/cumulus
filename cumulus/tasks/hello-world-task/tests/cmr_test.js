'use strict';

import test from 'ava';
import sinon from 'sinon';
import { S3 } from '@cumulus/ingest/aws';
import cmrjs from '@cumulus/cmrjs';
import payload from '@cumulus/test-data/payloads/modis/cmr.json';
import { handler } from '../index';

const result = {
  'concept-id': 'testingtesging'
};

test.before(() => {
  sinon.stub(S3, 'get').callsFake(() => ({ Body: '<xml></xml>' }));
});

test.cb.serial('should succeed if cmr correctly identifies the xml as invalid', (t) => {
  sinon.stub(cmrjs.CMR.prototype, 'getToken');
  const newPayload = JSON.parse(JSON.stringify(payload));
  handler(newPayload, {}, (e) => {
    cmrjs.CMR.prototype.getToken.restore();
    t.true(e instanceof cmrjs.ValidationError);
    t.end();
  });
});

test.cb.serial('should succeed with correct payload', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  sinon.stub(cmrjs.CMR.prototype, 'ingestGranule').callsFake(() => ({
    result
  }));
  handler(newPayload, {}, (e, r) => {
    cmrjs.CMR.prototype.ingestGranule.restore();
    t.is(e, null);
    t.is(
      r.payload.granules[0].cmr.link,
      `https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=${result['concept-id']}`
    );
    t.end(e);
  });
});

test.cb.serial('Should skip cmr step if the metadata file uri is missing', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.payload.granules = [{
    granuleId: 'some granule',
    files: [{
      filename: 's3://path/to/file.xml'
    }]
  }];

  handler(newPayload, {}, (e, r) => {
    t.is(r.payload.granules[0].cmr, undefined);
    t.end();
  });
});

test.after(() => {
  S3.get.restore();
});
