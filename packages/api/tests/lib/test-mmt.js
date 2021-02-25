'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');
const { CMR } = require('@cumulus/cmr-client');
const { randomId } = require('@cumulus/common/test-utils');
const cloneDeep = require('lodash/cloneDeep');
const mmt = rewire('../../lib/mmt');

const insertMMTLinks = mmt.__get__('insertMMTLinks');
const buildMMTLink = mmt.__get__('buildMMTLink');
const parseResults = mmt.__get__('parseResults');
const log = mmt.__get__('log');

test.beforeEach(async (t) => {
  t.context.env = process.env.CMR_ENVIRONMENT;
  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => []);
  t.context.restore = mmt.__set__('getCmrSettings', async () => ({
    password: 'fake',
  }));
});

test.afterEach.always(async (t) => {
  CMR.prototype.searchCollections.restore();
  t.context.restore();
  process.env.CMR_ENVIRONMENT = t.context.env;
});

test('parseResults parses results correctly', (t) => {
  const fakeESResults = [
    { version: '006', name: 'MOD09GQ', duplicateHandling: 'ignored' },
    { version: '001', name: 'ICK99NO', granuleId: 'ignored' },
    { version: '006', name: 'YUM88OK', granuleIdExtraction: 'ignored' },
  ];

  const expected = [
    { short_name: 'MOD09GQ', version: '006' },
    { short_name: 'ICK99NO', version: '001' },
    { short_name: 'YUM88OK', version: '006' },
  ];

  const actual = parseResults(fakeESResults);
  t.deepEqual(actual, expected);
});

test.serial(
  'Inserts MMT links into ES results when searchCollection returns an id',
  async (t) => {
    process.env.CMR_ENVIRONMENT = 'SIT';

    const fakeESResponse = {
      meta: {},
      results: [
        { version: '006', name: 'MOD09GQ' },
        { version: '001', name: 'ICK99NO' },
        { version: '006', name: 'YUM88OK' },
      ],
    };

    CMR.prototype.searchCollections.restore();
    sinon.stub(CMR.prototype, 'searchCollections').callsFake((obj) => [
      {
        id: `${obj.short_name}-${obj.version}`,
      },
    ]);
    const expected = {
      meta: {},
      results: [
        {
          version: '006',
          name: 'MOD09GQ',
          MMTLink: 'https://mmt.sit.earthdata.nasa.gov/collections/MOD09GQ-006',
        },
        {
          version: '001',
          name: 'ICK99NO',
          MMTLink: 'https://mmt.sit.earthdata.nasa.gov/collections/ICK99NO-001',
        },
        {
          version: '006',
          name: 'YUM88OK',
          MMTLink: 'https://mmt.sit.earthdata.nasa.gov/collections/YUM88OK-006',
        },
      ],
    };

    const actual = await insertMMTLinks(fakeESResponse);
    t.deepEqual(actual, expected);
  }
);

test.serial(
  'Does not insert MMT Links if CMR does not return a collection id',
  async (t) => {
    const fakeESResponse = {
      meta: {},
      results: [
        { version: '006', name: 'MOD09GQ' },
        { version: '001', name: 'ICK99NO' },
        { version: '006', name: 'YUM88OK' },
      ],
    };

    CMR.prototype.searchCollections.restore();
    sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => [{}]);
    const expected = {
      meta: {},
      results: [
        { version: '006', name: 'MOD09GQ', MMTLink: undefined },
        { version: '001', name: 'ICK99NO', MMTLink: undefined },
        { version: '006', name: 'YUM88OK', MMTLink: undefined },
      ],
    };

    const actual = await insertMMTLinks(fakeESResponse);
    t.deepEqual(actual, expected);
  }
);

test.serial(
  'insertMMTLinks returns the input unchanged if an error occurs with CMR.',
  async (t) => {
    const fakeESResponse = {
      meta: {
        irrelevant: 'information',
      },
      results: [
        { thisData: 'Can be anything' },
      ],
    };
    sinon.spy(log, 'error');
    const expected = cloneDeep(fakeESResponse);

    CMR.prototype.searchCollections.restore();
    const stubError = new Error('CMR is down today');
    sinon.stub(CMR.prototype, 'searchCollections').throws(stubError);

    const actual = await insertMMTLinks(fakeESResponse);

    t.deepEqual(actual, expected);
    t.true(log.error.calledWith('Unable to update inputResponse with MMT Links'));
    t.true(log.error.calledWith(stubError));

    log.error.restore();
  }
);

test('buildMMTLink creates expected links', (t) => {
  const tests = [
    { env: 'UAT', expected: 'https://mmt.uat.earthdata.nasa.gov/collections/' },
    { env: 'SIT', expected: 'https://mmt.sit.earthdata.nasa.gov/collections/' },
    { env: 'OPS', expected: 'https://mmt.earthdata.nasa.gov/collections/' },
  ];

  tests.forEach((aTest) => {
    process.env.CMR_ENVIRONMENT = aTest.env;
    const collectionId = randomId('collectionId-');
    const actual = buildMMTLink(collectionId);
    const expected = `${aTest.expected}${collectionId}`;
    t.is(actual, expected);
  });
});
