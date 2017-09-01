'use strict';
const test = require('ava');
const pdr = require('../pdr');

const goodFileFixture = require('./fixtures/good-pdr-fixture');

test('pdrToFileList() - generates an entry for each file', t => {
  const files = pdr.pdrToFileList(goodFileFixture.input, 'localhost', 21);
  t.is(files.length, 3);
});

test('fileSpecToFileEntry() - generates proper fields', t => {
  const pdrObj = pdr.parsePdr(goodFileFixture.input);
  const fileGroups = pdrObj.objects('FILE_GROUP');
  const host = 'localhost';
  const port = 21;
  let index = 0;
  fileGroups.forEach((fileGroup) => {
    const fileSpecs = fileGroup.objects('FILE_SPEC');
    fileSpecs.forEach((fileSpec) => {
      const fileName = goodFileFixture.fileName[index];
      const fileEntry = pdr.fileSpecToFileEntry(fileSpec, host, port);
      t.is(fileEntry.source.url, `ftp://${host}:${port}/${fileName}.tgz`);
      t.is(fileEntry.type, 'download');
      t.is(fileEntry.target, 'FROM_CONFIG');
      t.is(fileEntry.source.checksumType, 'MD5');
      t.is(fileEntry.source.checksum, goodFileFixture.cksum[index]);
      t.is(fileEntry.source.size, goodFileFixture.fileSize[index]);
    });
    index += 1;
  });
});
