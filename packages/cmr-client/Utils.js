'use strict';

const xml2js = require('xml2js');

exports.promisify = (fn) => (...args) =>
  new Promise((resolve, reject) => {
    fn(...args, (err, obj) => {
      if (err) reject(err);
      resolve(obj);
    });
  });

async function parseXMLString(xmlString) {
  const parseString = exports.promisify(xml2js.parseString);
  const xmlParseOptions = {
    ignoreAttrs: true,
    mergeAttrs: true,
    explicitArray: false
  };

  return parseString(xmlString, xmlParseOptions);
}

exports.parseXMLString = parseXMLString;
