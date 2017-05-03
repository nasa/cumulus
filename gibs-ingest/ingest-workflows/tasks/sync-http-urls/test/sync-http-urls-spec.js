"use strict";

const sinon = require('sinon');
const http = require('http');

//const sync = require('../tasks/sync/http-sync');
//const s3util = require('../tasks/sync/http-sync/s3util');

describe('sync-http-urls.handler', () => {
  it('pending', () => null);
});

xdescribe('sync-http-urls.handler', function() {
  const BUCKET_NAME = 'testbucket';
  const SOURCE_KEY = 'some/test/key';
  const DEST_KEY = 'some/test/key.synced';

  const message = {
    Records: [{
      s3: {
        bucket: {name: BUCKET_NAME},
        object: {key: SOURCE_KEY}
      }
    }]
  };

  let existingState;
  let updatedState;

  let setS3Json = function(obj, key) {
    let withArgs = s3util.s3.getObject.withArgs({Bucket: BUCKET_NAME, Key: key});
    if (obj) {
      withArgs.yields(null, {Body: JSON.stringify(obj)})
    }
    else {
      withArgs.yields("No body", null);
    }
  }

  let setExistingState = function(obj) {
    existingState = obj;
    setS3Json(obj, DEST_KEY);
  };

  let setUpdatedState = function(obj) {
    updatedState = obj;
    setS3Json(obj, SOURCE_KEY);
  };

  let makeState = function(filecount) {
    let files = [];
    for (let i = 0; i < filecount; i++) {
      let filename = "file" + i + ".png"
      files.push({
        product: "a",
        parent: "b",
        filename: filename,
        url: "http://example.com/" + filename,
        version: "0"
      });
    }
    return {files: files};
  };

  let onBeforeInvoke = function(mockFn, handler) {
    let behavior = sinon.behavior.create(mockFn);
    let originalInvoke = behavior.invoke;
    behavior.invoke = function () {
      handler();
      return originalInvoke.apply(this, arguments);
    };
    s3util.s3.upload.defaultBehavior = behavior;
  };

  let expectSyncResult = function(syncedFiles, newState, options) {
    options = options || {};
    http.get.yields("some body");
    s3util.s3.upload.yields(null, null);

    sync.handler(message, {}, options.callback || function() {})

    for (let file of syncedFiles) {
      sinon.assert.calledWith(http.get, file.url);
      sinon.assert.calledWith(
        s3util.s3.upload,
        {
          Bucket: BUCKET_NAME,
          Key: [file.product, file.parent, file.filename].join("/"),
          Body: "some body"
        });
    }
    sinon.assert.calledWith(
      s3util.s3.upload,
      {
        Bucket: BUCKET_NAME,
        Key: DEST_KEY,
        Body: JSON.stringify(newState)
      });

    // Assert the counts are correct to ensure nothing else has been uploaded
    sinon.assert.callCount(http.get, syncedFiles.length + (options.httpGetErrors || 0));
  };

  beforeEach(function() {
    sinon.stub(s3util.s3, 'upload');
    sinon.stub(s3util.s3, 'getObject');
    sinon.stub(http, 'get').returns({on: function() {}});
    sinon.stub(sync.log, 'info');
    sinon.stub(sync.log, 'error');
  });

  afterEach(function() {
    s3util.s3.getObject.restore();
    s3util.s3.upload.restore();
    http.get.restore();
    sync.log.info.restore();
    sync.log.error.restore();
  });

  describe('when there are no updates', function() {
    beforeEach(function() {
      setExistingState(makeState(3));
      setUpdatedState(makeState(3));
    });

    it('performs no sync activities', function() {
      let callback = sinon.mock().once().withArgs(null, {complete: true, updated: 0});
      sync.handler(message, {}, callback);
      callback.verify();
    });
  });

  describe('when there are updates', function() {
    beforeEach(function() {
      setExistingState(makeState(3));
      setUpdatedState(makeState(4));
    });

    it('synchronizes each updated file', function() {
      expectSyncResult([updatedState.files[3]], updatedState)
    });

    it('calls the callback with no errors', function() {
      let callback = sinon.mock().once().withArgs(null, {complete: true, updated: 1});
      expectSyncResult([updatedState.files[3]], updatedState, {callback: callback})
      callback.verify();
    });
  });

  describe('when execution times out before all updates can complete', function() {
    //const originalTimeout = sync.TIMEOUT_TIME_MS;

    beforeEach(function() {
      setExistingState(makeState(1));
      setUpdatedState(makeState(10));

      let n = 0;
      onBeforeInvoke(s3util.s3.upload, function () {
        if (n > 0) sync.TIMEOUT_TIME_MS = -1;
        n++;
      });
    });

    afterEach(function() {
      sync.TIMEOUT_TIME_MS = originalTimeout;
    });

    it('does not process any further updates, saving the partial state', function() {
      let partialState = { files: updatedState.files.slice(0, 3) };
      expectSyncResult(updatedState.files.slice(1, 3), partialState);
    });

    it('calls back with an incomplete status', function() {
      let callback = sinon.mock().once().withArgs(null, {complete: false, updated: 2});
      let partialState = { files: updatedState.files.slice(0, 3) };
      expectSyncResult(updatedState.files.slice(1, 3), partialState, {callback: callback});
      callback.verify();
    });

    it('continues processing when called back with its saved state', function() {
      let callback = sinon.mock().once().withArgs(null, {complete: false, updated: 2});
      let partialState = { files: updatedState.files.slice(0, 3) };
      setExistingState(partialState);
      let nextPartialState = { files: updatedState.files.slice(0, 5) };
      expectSyncResult(updatedState.files.slice(3, 5), nextPartialState, {callback: callback});
      callback.verify();
    });
  });

  describe('syncing a file that produces an error', function() {
    beforeEach(function() {
      setExistingState(makeState(1));
      setUpdatedState(makeState(5));
      s3util.s3.upload.onFirstCall().yields("s3 upload error", null)
      http.get.onThirdCall().returns({on: function() {}}).yields({statusCode: 404});
    });

    it('synchronizes all files which did not produce the error and saves their execution state', function() {
      let uploaded = updatedState.files.slice(1);
      uploaded.splice(2, 1);
      let succeeded = uploaded.concat();
      succeeded[0] = existingState.files[0];
      expectSyncResult(uploaded, {files: succeeded}, {httpGetErrors: 1});
    });

    it('calls the callback with an error', function() {
      let uploaded = updatedState.files.slice(1);
      uploaded.splice(2, 1);
      let succeeded = uploaded.concat();
      succeeded[0] = existingState.files[0];
      let callback = sinon.mock().once().withArgs(["s3 upload error", "HTTP Error 404"], {complete: false, updated: 2});
      expectSyncResult(uploaded, {files: succeeded}, {httpGetErrors: 1, callback: callback});
    });
  });
});
