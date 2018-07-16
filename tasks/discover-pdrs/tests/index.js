'use strict';

const test = require('ava');
const path = require('path');
const fs = require('fs-extra');
const { FTPError, RemoteResourceError } = require('@cumulus/common/errors');
const { cloneDeep } = require('lodash');
const models = require('@cumulus/api/models');

const { discoverPdrs } = require('../index');
const input = require('./fixtures/input.json');

const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const {
  findTestDataDirectory,
  randomString,
  validateConfig,
  validateOutput
} = require('@cumulus/common/test-utils');

// let PdrsTable;
let pdrModel;

test.before(async () => {
  process.env.PdrsTable = randomString();

  // PdrsTable = randomString();
  await models.Manager.createTable(process.env.PdrsTable, { name: 'pdrName', type: 'S' });

  pdrModel = new models.Pdr();
});

test.after.always(async () => {
  await models.Manager.deleteTable(process.env.PdrsTable);
});

test.serial('test pdr discovery with FTP assuming all PDRs are new', async (t) => {
  const event = cloneDeep(input);
  event.config.collection.provider_path = '/pdrs/discover-pdrs';
  event.config.useList = true;
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  await validateConfig(t, event.config);

  const output = await discoverPdrs(event, {});

  await validateOutput(t, output);
  t.is(output.pdrs.length, 5);
});

test.serial('test pdr discovery with FTP invalid user/pass', async (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser1',
    password: 'testpass'
  };

  const newPayload = cloneDeep(input);
  newPayload.config.provider = provider;
  newPayload.input = {};

  await validateConfig(t, newPayload.config);

  return discoverPdrs(newPayload, {})
    .then(t.fail)
    .catch((e) => {
      if (e instanceof RemoteResourceError) {
        t.pass('ignoring this test. Test server seems to be down');
      }
      else {
        t.true(e instanceof FTPError);
        t.true(e.message.includes('Login incorrect'));
      }
    });
});

test.serial('test pdr discovery with FTP connection refused', async (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    port: 30, // using port that doesn't exist to nonresponsiveness
    username: 'testuser1',
    password: 'testpass'
  };

  const newPayload = cloneDeep(input);
  newPayload.config.provider = provider;
  newPayload.input = {};

  await validateConfig(t, newPayload.config);

  return discoverPdrs(newPayload, {})
    .then(t.fail)
    .catch((e) => {
      t.true(e instanceof RemoteResourceError);
    });
});

test.serial('test pdr discovery with FTP assuming some PDRs are new', async (t) => {
  const provider = {
    id: 'MODAPS',
    protocol: 'ftp',
    host: 'localhost',
    username: 'testuser',
    password: 'testpass'
  };

  const newPayload = cloneDeep(input);
  newPayload.config.useList = true;
  newPayload.config.provider = provider;
  newPayload.config.collection.provider_path = '/pdrs/discover-pdrs';
  newPayload.input = {};

  await validateConfig(t, newPayload.config);

  await pdrModel.create({
    pdrName: 'PDN.ID1611071307.PDR',
    provider: provider.id,
    collectionId: '12',
    status: 'running',
    createdAt: 42
  });

  try {
    const output = await discoverPdrs(newPayload, {});

    await validateOutput(t, output);
    t.is(output.pdrs.length, 4);
  }
  finally {
    await pdrModel.delete({ pdrName: 'PDN.ID1611071307.PDR' });
  }
});

test.serial('test pdr discovery with HTTP assuming some PDRs are new', async (t) => {
  const testDataDirectory = path.join(await findTestDataDirectory(), 'pdrs', 'discover-pdrs');
  const pdrFilenames = await fs.readdir(testDataDirectory);
  const oldPdr = pdrFilenames[0];
  const newPdrs = pdrFilenames.slice(1);

  // Build the event
  const event = cloneDeep(input);
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'http',
    host: 'http://localhost:3030'
  };
  event.config.collection.provider_path = '/pdrs/discover-pdrs';
  event.input = {};

  await validateConfig(t, event.config);

  await pdrModel.create({
    pdrName: oldPdr,
    provider: event.config.provider.id,
    collectionId: '12',
    status: 'running',
    createdAt: 42
  });

  try {
    const output = await discoverPdrs(event, {});

    await validateOutput(t, output);

    t.is(output.pdrs.length, 4);
    const names = output.pdrs.map((p) => p.name);
    newPdrs.forEach((pdr) => t.true(names.includes(pdr)));
  }
  finally {
    // Clean up
    await pdrModel.delete({ pdrName: oldPdr });
  }
});

test.serial('test pdr discovery with SFTP assuming some PDRs are new', async (t) => {
  // Figure out the directory paths that we're working with
  const testDataDirectory = path.join(await findTestDataDirectory(), 'pdrs', 'discover-pdrs');

  // Copy the PDRs to the SFTP directory
  const pdrFilenames = await fs.readdir(testDataDirectory);
  const oldPdr = pdrFilenames[0];
  const newPdrs = pdrFilenames.slice(1);

  // Build the event
  const event = cloneDeep(input);
  event.config.provider = {
    id: 'MODAPS',
    protocol: 'sftp',
    host: 'localhost',
    port: 2222,
    username: 'user',
    password: 'password'
  };
  event.config.collection.provider_path = 'pdrs/discover-pdrs';
  event.input = {};

  await validateConfig(t, event.config);

  await pdrModel.create({
    pdrName: oldPdr,
    provider: event.config.provider.id,
    collectionId: '12',
    status: 'running',
    createdAt: 42
  });

  try {
    const output = await discoverPdrs(event, {});

    await validateOutput(t, output);

    t.is(output.pdrs.length, 4);
    const names = output.pdrs.map((p) => p.name);
    newPdrs.forEach((pdr) => t.true(names.includes(pdr)));
  }
  finally {
    // Clean up
    await pdrModel.delete({ pdrName: oldPdr });
  }
});
