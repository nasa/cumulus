'use strict';

const test = require('ava');
const request = require('supertest');
const pckg = require('../../package.json');
const { app } = require('../../app');

test('returns expected response', async (t) => {
  const response = await request(app)
    .get('/version')
    .set('Accept', 'application/json')
    .expect(200);

  t.is(response.status, 200);

  t.is(response.body.response_version, 'v1');
  t.is(response.body.api_version, pckg.version);
});
