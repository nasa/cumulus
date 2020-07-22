'use strict';

const { ESSearchQueue } = require('./esSearchQueue');

class ESCollectionGranuleQueue extends ESSearchQueue {
  constructor(queryStringParameters, esIndex) {
    const sortParams = {
      sort: [
        { granuleId: { order: 'asc' } }
      ]
    };
    const superQueryStringParameters = { sortParams, ...queryStringParameters };
    super(superQueryStringParameters, 'granule', esIndex);
  }
}

module.exports = { ESCollectionGranuleQueue };
