'use strict';

const { promisify } = require('util');
const xml2js = require('xml2js');

async function parseXMLString(xmlString) {
  const parseString = promisify(xml2js.parseString);
  const xmlParseOptions = {
    ignoreAttrs: true,
    mergeAttrs: true,
    explicitArray: false
  };

  return parseString(xmlString, xmlParseOptions);
}

exports.parseXMLString = parseXMLString;
