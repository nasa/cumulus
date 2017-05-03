"use strict";

const EventEmitter = require('events');
const Crawler = require('simplecrawler');
const log = require('gitc-common/log');

module.exports = class HttpTileCrawler extends EventEmitter {
  constructor(url, pattern, connectionLimit = 10) {
    super();
    this.url = url;
    this.pattern = pattern;
    this.connectionLimit = connectionLimit;
  }

  crawl() {
    const crawler = this._initCrawler();
    this._discoveredFiles = [];
    crawler.discoverResources = (buffer, queueItem) => this._discoverResources(buffer, queueItem);
    crawler.start();
  }

  _forward(event, logLevel = 'debug') {
    let lastLog = null;
    let intermediates = 0;
    this._crawler.on(event, (queueItem, opts) => {
      if (logLevel === 'error' || !lastLog || new Date() > 1000 + lastLog) {
        const suppression = intermediates > 0 ? `(${intermediates} messages supressed)` : '';
        log[logLevel](event, queueItem.path, suppression);
        lastLog = +new Date();
        intermediates = 0;
      }
      else {
        intermediates++;
      }
      this.emit(event, queueItem, opts);
    });
  }

  _initCrawler() {
    const crawler = this._crawler = new Crawler(this.url);
    crawler.interval = 0;
    crawler.maxConcurrency = this.connectionLimit;
    crawler.respectRobotsTxt = false;
    crawler.userAgent = 'Cumulus-GIBS';
    //this._forward('fetchstart');
    this._forward('fetchcomplete');
    this._forward('fetcherror', 'error');

    crawler.on('complete', () => {
      this.emit('complete', this._discoveredFiles);
      this._crawler = null;
      this._discoveredFiles = null;
    });
    this._addFetchConditions(crawler);
    return crawler;
  }

  _parseUrls(/* buffer, queueItem */) {
    throw new Error('HttpTileCrawler#_parseUrls is abstract');
  }

  _addFetchConditions(/* crawler */) {
  }

  _bail(reason, queueItem) {
    log.error(`[ERROR] Could not process ${queueItem.url}: ${reason}`);
    return [];
  }

  _discoverResources(buffer, queueItem) {
    const result = [];
    for (const item of this._parseUrls(buffer, queueItem)) {
      const url = this._crawler.cleanExpandResources([item.path], queueItem)[0];
      const fields = this.pattern.match(url);
      if (item.isDirectory || fields) {
        result.push(url);
      }
      if (fields) {
        this._discoveredFiles.push({ url: url, version: item.version, fields: fields });
      }
    }
    return result;
  }
};
