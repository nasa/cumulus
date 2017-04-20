'use strict';

// A sample set of code to demonstrate the project

// Ephemeral in-memory data store
const getUser = (users, userId) =>
  users.find(u => u.id === userId);

module.exports = {
  users: [
    {
      id: 1,
      name: 'Joe'
    }, {
      id: 2,
      name: 'Jane'
    }
  ],
  getUser: getUser
};
