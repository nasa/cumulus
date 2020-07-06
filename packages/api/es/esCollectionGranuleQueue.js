'use strict';

const { ESSearchQueue } = require('./esSearchQueue');

class ESCollectionGranuleQueue extends ESSearchQueue {
  constructor(queryStringParameters, type = 'granule', esIndex) {
    const sortParams = {
      sort: [
        { granuleId: { order: 'asc' } }
      ]
    };
    const superQueryStringParameters = { sortParams, ...queryStringParameters };
    super(superQueryStringParameters, type, esIndex);
  }
}

module.exports = { ESCollectionGranuleQueue };
