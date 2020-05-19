'use strict';

/**
 * This script should be used to build zip files for deployment to Lambda. It
 * hard-codes the timestamp of each file in the generated zip so that identical
 * files with different timestamps will result in an identical Lambda.
 */

const fs = require('fs');
const archiver = require('archiver');

const isDirectory = (x) => fs.statSync(x).isDirectory();

// The first command line argument is the name of the zip file to generate. The
// other arguments are the files to add to the zip.
const [zipPath, ...files] = process.argv.slice(2);

// I had to pick a date to use for all of the files, so why not
// https://en.wikipedia.org/wiki/2009_Stanley_Cup_Finals#Game_seven
const date = new Date('2009-06-12');

const archive = archiver('zip');

archive.pipe(fs.createWriteStream(zipPath));

files
  .filter((x) => x !== '.')
  .forEach(
    (name) => {
      if (isDirectory(name)) {
        archive.directory(name, undefined, { date });
      } else {
        archive.append(fs.createReadStream(name), { date, name });
      }
    }
  );

archive.finalize();
