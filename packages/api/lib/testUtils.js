'use strict';

const { randomString } = require('@cumulus/common/test-utils');

function testEndpoint(endpoint, event, testCallback) {
  return new Promise((resolve, reject) => {
    endpoint(event, {
      succeed: (response) => resolve(testCallback(response)),
      fail: (e) => reject(e)
    });
  });
}

/**
 * creates fake granule records
 *
 * @param {string} status - granule status (default to completed)
 * @returns {Object} fake granule object
 */
function fakeGranuleFactory(status = 'completed') {
  return {
    granuleId: randomString(),
    collectionId: 'fakeCollection___v1',
    status,
    execution: randomString(),
    createdAt: Date.now(),
    published: true,
    cmrLink: 'example.com',
    productVolume: 100
  };
}

/**
 * creates fake rule record
 *
 * @param {string} state - rule state (default to DISABLED)
 * @returns {Object} fake rule object
 */
function fakeRuleFactory(state = 'DISABLED') {
  return {
    name: randomString(),
    workflow: randomString(),
    provider: randomString(),
    collection: {
      name: randomString(),
      version: '0.0.0'
    },
    rule: {
      type: 'onetime'
    },
    state
  };
}

/**
 * creates fake pdr records
 *
 * @param {string} status - pdr status (default to completed)
 * @returns {Object} fake pdr object
 */
function fakePdrFactory(status = 'completed') {
  return {
    pdrName: randomString(),
    collectionId: 'fakeCollection___v1',
    provider: 'fakeProvider',
    status,
    createdAt: Date.now()
  };
}

/**
 * creates fake execution records
 *
 * @param {string} status - pdr status (default to completed)
 * @returns {Object} fake execution object
 */
function fakeExecutionFactory(status = 'completed') {
  return {
    arn: randomString(),
    name: randomString(),
    status,
    createdAt: Date.now()
  };
}

/**
 * creates fake collection records
 *
 * @returns {Object} fake pdr object
 */
function fakeCollectionFactory() {
  return {
    name: randomString(),
    version: '0.0.0',
    provider_path: '/',
    duplicateHandling: 'replace',
    granuleId: '^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
    granuleIdExtraction: '(MOD09GQ\\.(.*))\\.hdf',
    sampleFileName: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
    files: []
  };
}

module.exports = {
  testEndpoint,
  fakeGranuleFactory,
  fakePdrFactory,
  fakeCollectionFactory,
  fakeExecutionFactory,
  fakeRuleFactory
};
