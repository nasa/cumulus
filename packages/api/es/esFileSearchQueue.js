'use strict';

const { buildS3Uri } = require('@cumulus/aws-client/S3');
const { Search, defaultIndexAlias } = require('./search');

const defaultESScrollDuration = '30s';

const sameBucket = (bucket) => (object) =>
  object.bucket && object.bucket === bucket;

const s3UrlBuilder = (object) => buildS3Uri(object.bucket, object.key);

const buildFilesResponse = (granuleFilesList, bucket) =>
  granuleFilesList.map((gfl) =>
    gfl.files.filter(sameBucket(bucket)).map(s3UrlBuilder));

class ESFileSearchQueue {
  constructor(bucket, esIndex) {
    this.items = [];
    this.bucket = bucket;
    this.params = {
      index: esIndex || defaultIndexAlias,
      type: 'granule',
      size: 1000,
      scroll: defaultESScrollDuration,
      _source: ['files'],
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

module.exports = ESFileSearchQueue;
