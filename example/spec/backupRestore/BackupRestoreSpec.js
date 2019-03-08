'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const chunk = require('lodash.chunk');
const restore = require('@cumulus/api/bin/restore');
const backup = require('@cumulus/api/bin/backup');
const { Granule } = require('@cumulus/api/models');
const { fakeGranuleFactory } = require('@cumulus/api/lib/testUtils');
const { loadConfig } = require('../helpers/testUtils');

let tempFolder;
const config = loadConfig();

describe('Backup and Restore', () => {
  let initialRecordCount;
  let restoreFile;
  const granuleIds = [];
  const limit = 30;
  process.env.GranulesTable = `${config.prefix}-GranulesTable`;
  const model = new Granule();


  beforeAll(async () => {
    // create temp folder
    tempFolder = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);

    // create fake granule records
    restoreFile = path.join(tempFolder, 'recordsToRestore.json');

    let fileContent = '';
    for (let i = 0; i < limit; i += 1) {
      const granule = fakeGranuleFactory();
      fileContent += `${JSON.stringify(granule)}\n`;
      granuleIds.push({ granuleId: granule.granuleId });
    }
    fs.writeFileSync(restoreFile, fileContent);

    // count records in the table
    const t = await model.scan(null, null, 0, 'COUNT');
    initialRecordCount = t.Count;
  });

  describe('30 records', () => {
    it('are restored successfully to dynamoDB', async () => {
      await restore(restoreFile, process.env.GranulesTable, 2);

      // count the records
      const t = await model.scan(null, null, 0, 'COUNT');
      expect(t.Count).toEqual(initialRecordCount + limit);

      // randomly check one of the granules
      const randomIndex = Math.floor(Math.random() * Math.floor(limit));
      const record = await model.get(granuleIds[randomIndex]);
      expect(record.granuleId).toEqual(granuleIds[randomIndex].granuleId);
    });

    it('are backed up successfully from dynamoDB', async () => {
      await backup(process.env.GranulesTable, undefined, tempFolder);

      const backupFile = path.join(tempFolder, `${process.env.GranulesTable}.json`);

      // open backup file and compare records
      const content = fs.readFileSync(backupFile, 'utf8');
      const randomIndex = Math.floor(Math.random() * Math.floor(limit));
      const testGranuleId = granuleIds[randomIndex].granuleId;
      expect(content.includes(testGranuleId)).toEqual(true);
    });
  });

  afterAll(async () => {
    const chunked = chunk(granuleIds, 25);
    // delete the records
    await Promise.all(chunked.map((c) => model.batchWrite(c)));

    // delete temp folder
    fs.remove(tempFolder);
  });
});
