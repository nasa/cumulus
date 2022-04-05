'use strict';

const fs = require('fs');
const test = require('ava');
const { generateChecksumFromStream } = require('..');
const { normalizeHashAlgorithm } = require('../dist/checksum');

test('generateChecksumFromStream returns correct cksum for file stream', async (t) => {
  const dummyFileCksum = '1685297147';
  const result = await generateChecksumFromStream(
    'CKSUM',
    fs.createReadStream('./tests/data/dummyfile.txt'),
    {}
  );
  t.is(result, dummyFileCksum);
});

test('generateChecksumFromStream returns correct md5 for file stream', async (t) => {
  const dummyFileMD5 = 'bc8bfaaaa002658c97d4746e055b1e5a';
  const result = await generateChecksumFromStream(
    'md5',
    fs.createReadStream('./tests/data/dummyfile.txt'),
    {}
  );
  t.is(result, dummyFileMD5);
});

test('normalizeHashAlgorithm returns expected values', (t) => {
  t.is(normalizeHashAlgorithm('SHA1'), 'SHA1');
  t.is(normalizeHashAlgorithm('SHA-1'), 'SHA1');

  t.is(normalizeHashAlgorithm('SHA2'), 'SHA2');
  t.is(normalizeHashAlgorithm('SHA-2'), 'SHA2');

  t.is(normalizeHashAlgorithm('SHA256'), 'SHA256');
  t.is(normalizeHashAlgorithm('SHA-256'), 'SHA256');

  t.is(normalizeHashAlgorithm('SHA384'), 'SHA384');
  t.is(normalizeHashAlgorithm('SHA-384'), 'SHA384');

  t.is(normalizeHashAlgorithm('SHA512'), 'SHA512');
  t.is(normalizeHashAlgorithm('SHA-512'), 'SHA512');

  t.is(normalizeHashAlgorithm('OTHER'), 'OTHER');
});
