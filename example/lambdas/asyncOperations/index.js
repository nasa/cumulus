'use strict';

module.exports = {
  fail: () => Promise.reject(new Error('triggered failure')),
  success: (event) => Promise.resolve(event),
};
