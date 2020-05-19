'use strict';

const fs = require('fs');
const archiver = require('archiver');

const isDirectory = (x) => fs.statSync(x).isDirectory();

const [zipPath, ...files] = process.argv.slice(2);

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
