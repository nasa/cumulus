const nock = require('nock');
const test = require('ava');

const { CognitoClient } = require('../dist/src');

test.before(() => {
  nock.disableNetConnect();
});

test('The CognitoClient constructor throws a TypeError if clientId is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientPassword: 'client-password',
        cognitoLoginUrl: 'http://www.example.com',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    {
      instanceOf: TypeError,
      message: 'clientId is required',
    }
  );
});

test('The CognitoClient constructor throws a TypeError if clientPassword is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        cognitoLoginUrl: 'http://www.example.com',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    {
      instanceOf: TypeError,
      message: 'clientPassword is required',
    }
  );
});

test('The CognitoClient constructor throws a TypeError if cognitoLoginUrl is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    {
      instanceOf: TypeError,
      message: 'cognitoLoginUrl is required',
    }
  );
});

test('The CognitoClient constructor throws a TypeError if cognitoLoginUrl is not a valid URL', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        cognitoLoginUrl: 'asdf',
        redirectUri: 'http://www.example.com/cb',
      });
    },
    { instanceOf: TypeError }
  );
});

test('The CognitoClient constructor throws a TypeError if redirectUri is not specified', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        cognitoLoginUrl: 'http://www.example.com',
      });
    },
    {
      instanceOf: TypeError,
      message: 'redirectUri is required',
    }
  );
});

test('The CognitoClient constructor throws a TypeError if redirectUri is not a valid URL', (t) => {
  t.throws(
    () => {
      new CognitoClient({
        clientId: 'client-id',
        clientPassword: 'client-password',
        cognitoLoginUrl: 'http://www.example.com',
        redirectUri: 'asdf',
      });
    },
    { instanceOf: TypeError }
  );
});
