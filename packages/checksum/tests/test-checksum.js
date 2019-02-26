'use strict';

const fs = require('fs');
const test = require('ava');
const { generateChecksumFromStream } = require('..');

test('generateChecksumFromStream returns correct cksum for file stream', async (t) => {
  const dummyFileCksum = 1685297147;
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
