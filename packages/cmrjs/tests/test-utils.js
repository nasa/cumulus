'use strict';

const test = require('ava');

const {
  ummVersionToMetadataFormat,
} = require('../utils');

test('ummVersionToMetadataFormat returns correct metadata format for UMM-G versions', (t) => {
  let actual = ummVersionToMetadataFormat('1.6.2');
  t.is('umm_json_v1_6_2', actual);

  actual = ummVersionToMetadataFormat('1.5');
  t.is('umm_json_v1_5', actual);
});
