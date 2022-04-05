'use strict';

const test = require('ava');
const sinon = require('sinon');
const rewire = require('rewire');
const path = require('path');
const { randomId, readJsonFixture } = require('@cumulus/common/test-utils');
const cloneDeep = require('lodash/cloneDeep');
const mmt = rewire('../../lib/mmt');

const insertMMTLinks = mmt.__get__('insertMMTLinks');
const buildMMTLink = mmt.__get__('buildMMTLink');
const parseResults = mmt.__get__('parseResults');
const updateResponseWithMMT = mmt.__get__('updateResponseWithMMT');
const log = mmt.__get__('log');

/**
 *  Fakes a CMR return feed where each item in the list contains an
 *  collection_id labeled "id" that is made of the short_name and version
 * @param {Array<Object>} list - parsed list of collection results
 * @returns {Promise<Object>} Fake CMR responses
 */
const cmrReturnsWithIds = (list) => {
  const entry = list.map((l) => ({
    id: `${l.short_name}-${l.version}`,
    short_name: l.short_name,
    version_id: l.version,
  }));
  return Promise.resolve({ feed: { entry } });
};

/**
 * Fakes a CMR return feed where no items in the list have a collection_id.
 * @param {Array<Object>} list - parsed list of collection results
 * @returns {Promise<Object>} Fake CMR responses
 */
const cmrMissingCollection = (list) => {
  const entry = list.map(() => ({ }));
  return Promise.resolve({ feed: { entry } });
};

test.beforeEach((t) => {
  t.context.env = process.env.CMR_ENVIRONMENT;
});

test.afterEach.always((t) => {
  process.env.CMR_ENVIRONMENT = t.context.env;
});

test.serial('parseResults reshapes objects correctly', (t) => {
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

test.serial('updateResponseWithMMT merges entries from CMR with input collection response', async (t) => {
  const esResults = await readJsonFixture(path.join(__dirname, './fixtures/collectionESResult.json'));
  const cmrResults = await readJsonFixture(path.join(__dirname, './fixtures/cmrResults.json'));

  const expected = cloneDeep(esResults.results);
  process.env.CMR_ENVIRONMENT = 'UAT';
  expected[0].MMTLink = 'https://mmt.uat.earthdata.nasa.gov/collections/C987654321-CUMULUS';
  expected[1].MMTLink = 'https://mmt.uat.earthdata.nasa.gov/collections/C1237256734-CUMULUS';
  expected[2].MMTLink = undefined;

  const actual = updateResponseWithMMT(esResults.results, cmrResults.feed.entry);
  t.deepEqual(actual, expected);
});

test.serial(
  'Inserts MMT links into ES results when searchCollection returns an id',
  async (t) => {
    process.env.CMR_ENVIRONMENT = 'SIT';
    const restoreCmr = mmt.__set__('getCollectionsByShortNameAndVersion', cmrReturnsWithIds);

    const fakeESResponse = {
      meta: {},
      results: [
        { version: '006', name: 'MOD09GQ' },
        { version: '001', name: 'ICK99NO' },
        { version: '006', name: 'YUM88OK' },
      ],
    };

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
    restoreCmr();
  }
);

test.serial(
  'Does not insert MMT Links if CMR does not return a collection id',
  async (t) => {
    const restoreCmr = mmt.__set__('getCollectionsByShortNameAndVersion', cmrMissingCollection);
    const fakeESResponse = {
      meta: {},
      results: [
        { version: '006', name: 'MOD09GQ' },
        { version: '001', name: 'ICK99NO' },
        { version: '006', name: 'YUM88OK' },
      ],
    };

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
    restoreCmr();
  }
);

test.serial(
  'insertMMTLinks returns the input unchanged if an error occurs with CMR.',
  async (t) => {
    const cmrError = new Error('CMR is Down today!');
    const cmrIsDown = () => Promise.reject(cmrError);
    const restoreCmr = mmt.__set__('getCollectionsByShortNameAndVersion', cmrIsDown);
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

    const actual = await insertMMTLinks(fakeESResponse);

    t.deepEqual(actual, expected);
    t.true(log.error.calledWith('Unable to update inputResponse with MMT Links'));
    t.true(log.error.calledWith(cmrError));

    log.error.restore();
    restoreCmr();
  }
);

test('buildMMTLink creates expected links', (t) => {
  const tests = [
    { env: 'UAT', expected: 'https://mmt.uat.earthdata.nasa.gov/collections/' },
    { env: 'SIT', expected: 'https://mmt.sit.earthdata.nasa.gov/collections/' },
    { env: 'OPS', expected: 'https://mmt.earthdata.nasa.gov/collections/' },
    { env: 'PROD', expected: 'https://mmt.earthdata.nasa.gov/collections/' },
  ];

  tests.forEach((aTest) => {
    process.env.CMR_ENVIRONMENT = aTest.env;
    const collectionId = randomId('collectionId-');
    const actual = buildMMTLink(collectionId);
    const expected = `${aTest.expected}${collectionId}`;
    t.is(actual, expected);
  });
});
