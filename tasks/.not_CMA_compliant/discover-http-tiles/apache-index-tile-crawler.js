"use strict";

const HttpTileCrawler = require("./http-tile-crawler");

class ApacheIndexTileCrawler extends HttpTileCrawler {

  _addFetchConditions(crawler) {
    crawler.addFetchCondition((queueItem) => {
      const path = queueItem.path;
      return path.indexOf('?') === -1 && path.indexOf('.') === -1;
    });
  }

  _splitOnTag(string, tagName) {
    // Asssumes newlines are insignificant
    const replaceRegex = new RegExp(`\\s*<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>\\s*`, 'g');
    const result = string
      .replace(/\n/g, ' ')
      .replace(replaceRegex, "$1\n")
      .split("\n");
    result.pop();
    return result;
  }

  // Simple crawling method for the default Apache directories set up to serve MODAPS.
  // If we need to crawl something more complex, we can do so easily using the Cheerio
  // library, but since that pulls in a ton of dependencies and is unnecessary at this
  // point, that's not done here.
  _parseUrls(buffer, queueItem) {
    const result = [];
    const str = buffer.toString("utf8");
    const allRows = this._splitOnTag(str, 'tr');
    if (!allRows) {
      return this._bail(`Unexpected Apache index format ${str}`, queueItem);
    }

    const rows = [];
    for (const row of allRows) {
      if (row.indexOf('<th') === -1 && row.indexOf('Parent Directory') === -1) {
        rows.push(row);
      }
    }
    for (const row of rows) {
      // Split around the central date
      const cells = this._splitOnTag(row, 'td');
      if (cells.length !== 5) {
        const err = `length ${cells.length}, ${JSON.stringify(cells)}`;
        return this._bail(`Unexpected Apache index line format ${row}, ${err}`, queueItem);
      }
      const [, link, date, size] = cells.map((c) => c.trim());
      const pathMatch = link.match(/href="([^"]+)"/);
      if (!pathMatch) {
        return this._bail(`Unexpected Apache index line format ${row}, no href`, queueItem);
      }
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
