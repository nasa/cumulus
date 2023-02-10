const defaults = require('superagent-defaults');
const supertest = require('supertest');
const { version } = require('../../lib/version');

// Superagent-defaults allows us to set defaults *before* running HTTP method calls
// This request object is modified to always set the current API version such that
// all test calls are always valid
exports.request = (app) => defaults(supertest(app)).set('version', version);
