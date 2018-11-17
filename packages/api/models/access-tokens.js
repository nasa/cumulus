'use strict';

const Manager = require('./base');

class AccessToken extends Manager {
  constructor(params = {}) {
    super({
      tableName: params.tableName || process.env.AccessTokensTable,
      tableHash: { name: 'accessToken', type: 'S' }
    });
  }
}
module.exports = AccessToken;
