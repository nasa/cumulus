"use strict";

const HttpTileCrawler = require("./http-tile-crawler");

class ApacheIndexTileCrawler extends HttpTileCrawler {

  _addFetchConditions(crawler) {
    crawler.addFetchCondition((queueItem) => {
      const path = queueItem.path;
      return path.indexOf('?') === -1 && path.indexOf('.') === -1;
    });
  }

  // Simple crawling method for the default Apache directories set up to serve MODAPS.
  // If we need to crawl something more complex, we can do so easily using the Cheerio
  // library, but since that pulls in a ton of dependencies and is unnecessary at this
  // point, that's not done here.
  _parseUrls(buffer, queueItem) {
    const result = [];
    const str = buffer.toString("utf8");
    const splitContents = str.split("<hr>");
    if (splitContents.length !== 3) {
      return this._bail("Unexpected Apache index format", queueItem);
    }
    const lines = splitContents[1].trim().split("\n");
    for (const line of lines) {
      // Split on the whitespace around the central date
      const split = line.trim().split(/\s+(\d{2}-\w{3}-\d{4}\s+\d\d:\d\d)\s+/);
      if (split.length !== 3) {
        return this._bail(`Unexpected Apache index line format ${line}`, queueItem);
      }
      const [link, date, size] = split;
      const pathMatch = link.match(/href="([^"]+)"/);
      if (!pathMatch) return this._bail(`Unexpected Apache index line format ${line}`, queueItem);
      if (!size.startsWith('0') && size.length > 0) {
        result.push({
          path: pathMatch[1],
          version: (`${date}s${size}`).toLowerCase().replace(/[^a-z0-9]+/g, ''),
          isDirectory: size === '-'
        });
      }
    }
    return result;
  }
}

module.exports = ApacheIndexTileCrawler;
