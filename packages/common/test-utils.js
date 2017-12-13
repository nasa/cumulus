'use strict';

const crypto = require('crypto');

/**
 * Generate a 40-character random string
 *
 * @returns {string} - a random string
 */
exports.randomString = () => crypto.randomBytes(20).toString('hex');
