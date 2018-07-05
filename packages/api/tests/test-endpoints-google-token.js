'use strict';

const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

const proxyquire = require('proxyquire');
const sinon = require('sinon');
const test = require('ava');

const plusStub = {
  people: {
    get: (object, cb) => {
      console.log(`object is ${JSON.stringify(object)}`)
      return cb('err', 'response');
    }
  }
}
sinon.stub(google, 'plus').returns(plusStub);

const googleTokenEndpoint = require('../endpoints/googleToken');

const event = {
  queryStringParameters: {
    code: '007',
    state: 'https://hulu.com'
  }
};

const eventWithoutCode = { queryStringParameters: {} };

let context = {
  succeed: (body) => {
    return body
  }
}

let callback = (err, response) => {
  if (err) throw err;
  return response;
};

let tokenStub;
let getTokenStub;

test.after(() => {
  tokenStub.restore();
  getTokenStub.restore();
});

test('login calls the token method when a code exists', (t) => {
  tokenStub = sinon.stub(googleTokenEndpoint, 'token').returns('fake-token');
  googleTokenEndpoint.login(event, {}, callback);
  t.is(tokenStub.calledOnce, true);
  tokenStub.restore();
});

test('login returns the response when code does not exist', (t) => {
  const loginResult = googleTokenEndpoint.login(eventWithoutCode, {}, callback);
  const googleOauthEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'access_type=offline&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email&' +
    'state=&response_type=code&client_id=&redirect_uri=';

  const responseObjcet = {
    statusCode: '301',
    body: 'Redirecting to Google Login',
    headers: {
      Location: googleOauthEndpoint
    }
  };
  t.deepEqual(loginResult, responseObjcet)
});

test('token returns an error when oauth2client returns an error', (t) => {
  getTokenStub = sinon.stub(OAuth2.prototype, 'getToken').yields('error in getToken', 'token');
  const result = googleTokenEndpoint.token(event, context);
  const expectedResult = {
    body: JSON.stringify({message: 'error in getToken'}),
    statusCode: 400
  };
  t.is(result.body, expectedResult.body);
  t.is(result.statusCode, expectedResult.statusCode);
  getTokenStub.restore();
});

test.only('token returns an error when oauth2client returns an error', (t) => {
  const tokens = {
    access_token: '',
    expiry_date: Date.now()
  }
  getTokenStub = sinon.stub(OAuth2.prototype, 'getToken').yields(null, tokens);
  //const peopleStub = sinon.stub(plus.people, 'get').yields(null, {data: 'userData'}, {data: 'userData'});
  const result = googleTokenEndpoint.token(event, context);

  t.is(result.body, expectedResult.body);
  t.is(result.statusCode, expectedResult.statusCode);
  getTokenStub.restore();
});

