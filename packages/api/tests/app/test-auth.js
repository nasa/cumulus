const test = require('ava');
const request = require('supertest');
const moment = require('moment');

const { app } = require('../../app');
const { createJwtToken } = require('../../lib/token');

test.before(() => {
  process.env.TOKEN_SECRET = 'foobar';
});

test('API request with expired token returns 401', async (t) => {
  const jwt = createJwtToken({
    accessToken: 'token',
    expirationTime: moment().unix(),
    username: 'user'
  });

  const response = await request(app)
    .get('/workflows')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwt}`)
    .expect(401);
  t.is(response.status, 401);
});
