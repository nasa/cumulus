'use strict';

const log = require('cumulus-common/log');
const fs = require('fs');
const path = require('path');

/**
 * A utility function to monitor a folder and copy any files to stdout after wrapping
 * them in text to make them useable as input to a Task. Needed for local testing
 * with the provider gateway.
 */
const main = (...args) => {
  // This is NOT robust argument handling - just enough for our needs
  const dir = args[2];
  // log.info(`WATCHING ${dir}`);
  fs.watch(dir, (_, fileName) => {
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      // log:info(`FILE: ${fileName}`);

      let fileContents = fs.readFileSync(filePath).toString();
      fileContents = fileContents.replace(/\n/g, ' ');
      log.warn(`inline-result: ${fileContents}`);
    }
  });
};

main(...process.argv);
