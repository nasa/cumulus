'use strict';

const test = require('ava');
const parsePdr = require('@cumulus/ingest/parse-pdr');

test('parse MODAPS PDR', async (t) => {
  const pdrFilePath = './tests/fixtures/MODAPSops7.1234567.PDR'
  const pdrName = 'MODAPSops7.1234567.PDR';

  class CollectionConfigStore {
    async get() {
      return '*';
    }
  }
  const collectionConfigStore = new CollectionConfigStore()

  // Note: This PDR contains a different type of checksum
  const parsedPdr = await parsePdr.parsePdr(pdrFilePath, collectionConfigStore, pdrName);
  t.is(parsedPdr.filesCount, 30);
  t.is(parsedPdr.granulesCount, 30);
  t.is(parsedPdr.granules.length, 30);
});
