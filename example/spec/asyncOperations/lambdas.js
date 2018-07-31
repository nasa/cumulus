'use strict';

module.exports = {
  fail: async () => {
    throw new Error('triggered failure');
  },
  success: async (event) => event
};
