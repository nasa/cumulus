'use strict';

const test = require('ava');
const { User } = require('../../models');

test('The Users model sets the tableName from a param', (t) => {
  const userModel = new User({ tableName: 'my-table-name' });

  t.is(userModel.tableName, 'my-table-name');
});

test.serial('The Users model sets the table name from the UsersTable environment variable', (t) => {
  const before = process.env.UsersTable;
  process.env.UsersTable = 'table-from-env';

  const userModel = new User();

  process.env.UsersTable = before;

  t.is(userModel.tableName, 'table-from-env');
});
