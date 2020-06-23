'use strict';

const Logger = require('@cumulus/logger');
const { Search, defaultIndexAlias } = require('./search');

const log = new Logger({ sender: '@api/es/esFileSearchQueue' });

const defaultESScrollSize = 2;
const defaultESScrollDuration = '30s';

const sameBucket = (bucket) => (object) =>
  object.bucket && object.bucket === bucket;

const buildFilesResponse = (granuleFilesList, bucket) =>
  granuleFilesList.map((gfl) =>
    gfl.files
      .filter(sameBucket(bucket))
      .map((object) => ({ granuleId: gfl.granuleId, ...object })));

class ESFileSearchQueue {
  constructor({ bucket, esIndex }) {
    this.items = [];
    this.bucket = bucket;
    this.params = {
      index: esIndex || defaultIndexAlias,
      type: 'granule',
      size: process.env.ES_SCROLL_SIZE || defaultESScrollSize,
      scroll: defaultESScrollDuration,
      _source: ['files', 'granuleId'],
      body: {
        query: {
          term: {
            'files.bucket.keyword': {
              value: `${bucket}`
            }
          }
        },
        sort: [
          {
            'files.key.keyword': {
              order: 'asc'
            }
          }
        ]
      }
    };
  }

  async peek() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items[0];
  }

  async shift() {
    if (this.items.length === 0) await this.fetchItems();
    return this.items.shift();
  }

  async fetchItems() {
    if (!this.esClient) {
      this.esClient = await Search.es();
    }

    let response;
    if (!this.scrollId) {
      response = await this.esClient
        .search(this.params)
        .then((searchResponse) => searchResponse.body);
    } else {
      response = await this.esClient
        .scroll({
          scrollId: this.scrollId,
          scroll: defaultESScrollDuration
        })
        .then((searchResponse) => searchResponse.body);
    }
    this.scrollId = response._scroll_id;
    const granuleFilesList = response.hits.hits.map((s) => s._source);
    const s3Files = buildFilesResponse(granuleFilesList, this.bucket);
    this.items = s3Files;
  }
}

module.exports = { ESFileSearchQueue };
