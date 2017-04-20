'use strict';

const User = require('../app/user');
const expect = require('expect.js');

describe('get user', () =>
  it('should find a user', () =>
    expect(User.getUser(User.users, 2)).to.eql({ id: 2, name: 'Jane' })
  )
);
