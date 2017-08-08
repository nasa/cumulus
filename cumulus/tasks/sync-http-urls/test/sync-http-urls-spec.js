"use strict";

const sinon = require('sinon');
const expect = require('expect.js');
const https = require('https');
const path = require('path');

const helpers = require('cumulus-common/test-helpers');
const aws = require('cumulus-common/aws');
const Task = require('cumulus-common/task');

const SyncHttpUrlsTask = require('../index');

describe('sync-http-urls.handler', () => {
  let existingState;
  let updatedState;

  const makePayload = (filecount) => {
    const urls = [];
    for (let i = 0; i < filecount; i++) {
      const filename = `file${i}.png`;
      urls.push({
        url: `https://example.com/${filename}`,
        version: `0`
      });
    }
    return urls;
  };

  /**
   * Given an array of indexes of payload items that should have been synced
   * returns a state object corresponding to those indexes having been synced
   * @param {array} indexes - The indexes (integers) of payload items
   * @return A state representing those indexes having been synced
   */
  const stateForSyncedIndexes = (indexes) => {
    const files = [];
    const completed = [];
    for (const index of indexes) {
      files.push({
        Bucket: 'some-stack-private',
        Key: `sources/EPSG4326/{meta.key}/file${index}.png` });
      completed.push(`https://example.com/file${index}.png0`);
    }
    return { files: files, completed: completed };
  };

  const makeState = (filecount) => {
    const payload = makePayload(filecount);
    const files = [];
    const completed = [];
    for (const file of payload) {
      const filename = path.basename(file.url);
      files.push({
        Bucket: 'STATE_BUCKET',
        Key: filename
      });
      completed.push(file.url + file.version);
    }
    return { files: files, completed: completed };
  };

  const countUpdates = (output) => {
    let result = 0;
    for (const file of output) {
      if (file.Bucket !== 'STATE_BUCKET') {
        result++;
      }
    }
    return result;
  };

  beforeEach(() => {
    sinon.stub(aws.s3(), 'upload')
         .yieldsAsync(null, null);
    sinon.stub(https, 'get')
         .yieldsAsync({ statusCode: 200, body: 'fake-data' })
         .returns({ on: () => {} });
  });

  afterEach(() => {
    aws.s3().upload.restore();
    https.get.restore();
  });

  describe('when there are no updates', () => {
    let result;
    let message;

    beforeEach(async (done) => {
      try {
        message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'SyncHttpUrls');
        message.payload = makePayload(3);
        message.state = makeState(3);
        [, result] = await helpers.run(SyncHttpUrlsTask, message);
      }
      finally {
        done();
      }
    });

    it('performs no sync activities', () => {
      expect(result.exception).to.equal('NotNeededWorkflowError');
    });
  });

  describe('when there are updates', () => {
    let result;
    let message;

    beforeEach(async (done) => {
      try {
        message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'SyncHttpUrls');
        message.payload = makePayload(4);
        message.state = makeState(3);
        [, result] = await helpers.run(SyncHttpUrlsTask, message);
      }
      finally {
        done();
      }
    });

    it('synchronizes each updated file', () => {
      expect(result.length).to.equal(4);
      expect(countUpdates(result)).to.equal(1);
    });
  });

  describe('when execution times out before all updates can complete', () => {
    let result;
    let message;

    beforeEach(async (done) => {
      try {
        message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'SyncHttpUrls');
        message.payload = makePayload(4);
        let n = 0;
        SyncHttpUrlsTask.prototype.endsWithin = () => n++ > 0;
        [, result] = await helpers.run(SyncHttpUrlsTask, message);
      }
      catch (e) {
        done(e);
      }
      finally {
        done();
      }
    });

    afterEach(() => {
      delete SyncHttpUrlsTask.prototype.endsWithin;
    });

    it('does not process any further updates, saving the partial state', () => {
      expect(message.stateOut).to.eql(stateForSyncedIndexes([0]));
    });

    it('returns an incomplete status', () => {
      expect(result.exception).to.equal('IncompleteWorkflowError');
    });

    it('continues processing when called back with its saved state', async (done) => {
      delete SyncHttpUrlsTask.prototype.endsWithin;
      message.state = message.stateOut;
      const [, result] = await helpers.run(SyncHttpUrlsTask, message);
      expect(result.length).to.equal(4);
      done();
    });
  });

  describe('syncing a file that produces an error', () => {
    let error;
    let message;

    beforeEach(async (done) => {
      try {
        message = helpers.collectionMessageInput('VNGCR_LQD_C1', 'SyncHttpUrls');
        message.payload = makePayload(5);
        aws.s3().upload.onFirstCall().yields('s3 upload error', null);
        https.get.onThirdCall().returns({ on: () => {} });
        https.get.onThirdCall().yieldsAsync({ statusCode: 404 });

        [error] = await helpers.run(SyncHttpUrlsTask, message);
      }
      catch (e) {
        done(e);
      }
      finally {
        done();
      }
    });

    it('synchronizes all files which did not produce the error', () => {
      expect(message.stateOut).to.eql(stateForSyncedIndexes([1, 3, 4]));
    });

    it('returns an error', () => {
      expect(error).not.to.be(null);
    });
  });
});
