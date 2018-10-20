'use strict';

const rewire = require('rewire');
const test = require('ava');
const httpAuth = rewire('../http-auth');
const TestHttpAuthMixin = httpAuth.httpAuthMixin;
const sinon = require('sinon');

const cookieString = 'snickerdoodle';
httpAuth.__set__('request', (uriOptions, cb) => {
  const updatedUriOptions = {
    headers: {
      'set-cookie': [ cookieString ],
      location: uriOptions.uri + 1
    },
  };
  cb(null, updatedUriOptions, {});
});
const mockResponse = {
  statusCode: 200,
  body: 'helloworld'
};
const testHttps = {
  get: function (urlOptions, cb) {
    cb(mockResponse);
  }
};
httpAuth.__set__('https', testHttps);
class MyTestSyncClass {}
class MyTestHttpAuthSyncClass extends TestHttpAuthMixin(MyTestSyncClass) {}
const myTestHttpAuthSyncClass = new MyTestHttpAuthSyncClass();

test('Follow redirects', async (t) => {
  const result = await httpAuth.followRedirects({
    currentRedirect: 0,
    numRedirects: 5,
    uriOptions: {
      uri: 0,
      headers: {}
    }
  });
  const expectedResult = {
    followRedirect: false,
    headers: {
      cookie: `${cookieString}; `.repeat(5)
    },
    method: 'GET',
    uri: 5
  };

  t.deepEqual(result, expectedResult);
});

test('sync', async (t) => {
  sinon.stub(httpAuth, 'followRedirects').resolves({});
  const httpsSpy = sinon.spy(testHttps, 'get');
  const response = await myTestHttpAuthSyncClass._getReadableStream('https://yolo.com');
  sinon.assert.calledWith(httpsSpy, {
    headers: {
      cookie: `${cookieString}; `.repeat(3)
    },
    host: 'yolo.com',
    path: '/'
  });
  t.is(response, mockResponse);
});
