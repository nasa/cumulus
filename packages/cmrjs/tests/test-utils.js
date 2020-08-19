'use strict';

const test = require('ava');

const {
  ummVersionToMetadataFormat,
} = require('../utils');

test('ummVersionToMetadataFormat returns correct metadata format for UMM-G versions', (t) => {
  let actual = ummVersionToMetadataFormat('1.4');
  t.is('umm_json_v1_4', actual);

  actual = ummVersionToMetadataFormat('1.5');
  t.is('umm_json_v1_5', actual);
});
