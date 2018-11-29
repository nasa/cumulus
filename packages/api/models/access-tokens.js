'use strict';

const Manager = require('./base');
const { accessToken: accessTokenSchema } = require('./schemas');

class AccessToken extends Manager {
  constructor(params = {}) {
    super({
      tableName: params.tableName || process.env.AccessTokensTable,
      tableHash: { name: 'accessToken', type: 'S' },
      schema: accessTokenSchema
    });
  }
}
module.exports = AccessToken;
