'use strict';

const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const { Map } = require('immutable');

const { createCache, cacheLookup, memoize } = require('../app/cache.js');

describe('cache.js', () => {
  describe('cacheLookup', () => {
    let callCountsByKey = Map();
    const lookup = (key) => {
      callCountsByKey = callCountsByKey.updateIn([key], v => (v ? v + 1 : 1));
      return callCountsByKey.get(key);
    };
    const cache = createCache();

    it('first lookup of key', (done) => {
      expect(cacheLookup(cache, 'keyA', lookup)).to.eventually.eql(1).and.notify(done);
    });
    it('subsequent lookups used cached value', (done) => {
      expect(cacheLookup(cache, 'keyA', lookup)).to.eventually.eql(1);
      expect(lookup('keyA')).to.eql(2);
      expect(lookup('keyA')).to.eql(3);
      expect(cacheLookup(cache, 'keyA', lookup)).to.eventually.eql(1).and.notify(done);
    });
    it('Looking up another key that is not cached', (done) => {
      expect(lookup('keyB')).to.eql(1);
      expect(cacheLookup(cache, 'keyB', lookup)).to.eventually.eql(2);
      expect(lookup('keyB')).to.eql(3);
      expect(cacheLookup(cache, 'keyB', lookup)).to.eventually.eql(2).and.notify(done);

      it('doesnt impact other cached values', (done2) => {
        expect(cacheLookup(cache, 'keyA', lookup)).to.eventually.eql(1).and.notify(done2);
      });
    });
  });

  describe('memoize', () => {
    let callCountsByKey = Map();
    const lookup = (key) => {
      callCountsByKey = callCountsByKey.updateIn([key], v => (v ? v + 1 : 1));
      return callCountsByKey.get(key);
    };

    const memo1 = memoize('memo1', lookup);
    const memo2 = memoize('memo2', lookup);

    it('first lookup of key', (done) => {
      expect(memo1('keyA')).to.eventually.eql(1).and.notify(done);
    });
    it('subsequent lookups used cached value', (done) => {
      expect(memo1('keyA')).to.eventually.eql(1);
      expect(lookup('keyA')).to.eql(2);
      expect(lookup('keyA')).to.eql(3);
      expect(memo1('keyA')).to.eventually.eql(1).and.notify(done);
    });
    it('Looking up another key that is not cached', (done) => {
      expect(lookup('keyB')).to.eql(1);
      expect(memo1('keyB')).to.eventually.eql(2);
      expect(lookup('keyB')).to.eql(3);
      expect(memo1('keyB')).to.eventually.eql(2).and.notify(done);

      it('doesnt impact other cached values', (done2) => {
        expect(memo1('keyA')).to.eventually.eql(1).and.notify(done2);
      });
    });

    it('other memos are distinct', (done) => {
      expect(memo2('keyA')).to.eventually.eql(4);
      expect(memo2('keyA')).to.eventually.eql(4).and.notify(done);
    });
  });
});
