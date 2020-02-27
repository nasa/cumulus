'use strict';

const test = require('ava');
const request = require('supertest');
const rewire = require('rewire');

const assertions = require('../../lib/assertions');

const stats = rewire('../../endpoints/stats');
const getType = stats.__get__('getType');

// import the express app after setting the env variables
const { app } = require('../../app');

test('GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET /stats/histogram without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats/histogram')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET /stats/aggregate without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET /stats/average without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/stats/average')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('GET without pathParameters and with an unauthorized user returns an unauthorized response');

test('GET /stats/histogram with an unauthorized user returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/histogram')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('GET /stats/aggregate with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/aggregate')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('GET /stats/average with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/stats/average')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(403);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('getType gets correct type for granules', (t) => {
  const type = getType({ params: { type: 'granules' } });

  t.is(type.type, 'granule');
});

test('getType gets correct type for collections', (t) => {
  const type = getType({ params: { type: 'collections' } });

  t.is(type.type, 'collection');
});

test('getType gets correct type for pdrs', (t) => {
  const type = getType({ params: { type: 'pdrs' } });

  t.is(type.type, 'pdr');
});

test('getType gets correct type for executions', (t) => {
  const type = getType({ params: { type: 'executions' } });

  t.is(type.type, 'execution');
});

test('getType gets correct type for logs', (t) => {
  const type = getType({ params: { type: 'logs' } });

  t.is(type.type, 'logs');
});

test('getType gets correct type for providers', (t) => {
  const type = getType({ params: { type: 'providers' } });

  t.is(type.type, 'provider');
});

test('getType returns undefined if type is not supported', (t) => {
  const type = getType({ params: { type: 'provide' } });

  t.falsy(type.type);
});

test('getType returns correct type from query params', (t) => {
  const type = getType({ query: { type: 'providers' } });

  t.is(type.type, 'provider');
});
