const test = require('ava');
const express = require('express');
const boom = require('express-boom');
const request = require('supertest');

const { EcsStartTaskError } = require('@cumulus/errors');

const { asyncOperationEndpointErrorHandler } = require('../../app/errors');

const app = express();
app.use(boom());

// Set up fake endpoint to just test middleware
app.post(
  '/fake-async-endpoint',
  () => {
    throw new Error('failed to start');
  },
  asyncOperationEndpointErrorHandler
);

app.post(
  '/fake-async-endpoint2',
  () => {
    throw new EcsStartTaskError('failed to start');
  },
  asyncOperationEndpointErrorHandler
);

test('request to replays endpoint returns 500 if starting ECS task throws unexpected error', async (t) => {
  const response = await request(app)
    .post('/fake-async-endpoint')
    .expect(500);
  t.is(response.status, 500);
});

test('request to replays endpoint returns 503 if starting ECS task throws EcsStartTaskError', async (t) => {
  const response = await request(app)
    .post('/fake-async-endpoint2')
    .send('ECS')
    .expect(503);
  t.is(response.status, 503);
});
