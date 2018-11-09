'use strict';

const rewire = require('rewire');
const test = require('ava');
const httpBasicAuth = rewire('../http-basicauth');
const TestHttpBasicAuthMixin = httpBasicAuth.httpBasicAuthMixin;
const sinon = require('sinon');

const cookieString = 'snickerdoodle';
httpBasicAuth.__set__('request', (uriOptions, cb) => {
  const updatedUriOptions = {
    headers: {
      'set-cookie': [cookieString],
      location: uriOptions.uri + 1
    }
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
httpBasicAuth.__set__('https', testHttps);
class MyTestSyncClass {}
class MyTestHttpBasicAuthSyncClass extends TestHttpBasicAuthMixin(MyTestSyncClass) {}
const myTestHttpBasicAuthSyncClass = new MyTestHttpBasicAuthSyncClass();

test('Follow redirects', async (t) => {
  const result = await httpBasicAuth.followRedirects({
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
  sinon.stub(httpBasicAuth, 'followRedirects').resolves({});
  const httpsSpy = sinon.spy(testHttps, 'get');
  const response = await myTestHttpBasicAuthSyncClass._getReadableStream('https://yolo.com');
  sinon.assert.calledWith(httpsSpy, {
    headers: {
      cookie: `${cookieString}; `.repeat(2)
    },
    host: 'yolo.com',
    path: '/'
  });
  t.is(response, mockResponse);
});
