import fs from 'fs';
import got from 'got';
import property from 'lodash.property';
import { parseString } from 'xml2js';
//import log from '@cumulus/common/log';
import {
  validate,
  ValidationError,
  updateToken,
  getUrl,
  xmlParseOptions
} from './utils';


const logDetails = {
  file: 'lib/cmrjs/index.js',
  source: 'pushToCMR',
  type: 'processing'
};

async function searchConcept(type, searchParams, existingResults) {
  const limit = process.env.CMR_LIMIT || 100;
  const pageSize = process.env.CMR_PAGE_SIZE || 50;
  let pageNum = 1;

  if (searchParams.page_num) {
    pageNum = searchParams.page_num + 1;
  }

  // Recursively retrieve all the search results for collections or granules
  // Also, parse them from XML into native JS objects
  const qs = Object.assign(
    Object.assign({ page_size: pageSize }, searchParams),
    { page_num: pageNum }
  );

  const body = await got(getUrl('search') + type, { query: qs });

  const str = await new Promise((resolve, reject) => {
    parseString(body, xmlParseOptions, (err, res) => {
      if (err) reject(err);

      if (res.errors) {
        const errorMessage = JSON.stringify(res.errors.error);
        throw new Error(errorMessage);
      }

      resolve(res);
    });
  });

  const _existingResults = existingResults.concat(str.results.references.reference || []);

  const servedSoFar = (
    ((qs.page_num - 1) * qs.page_size) +
    (str.results.references ? str.results.references.reference.length : 0)
  );
  const isThereAnotherPage = str.results.hits > servedSoFar;
  if (isThereAnotherPage && servedSoFar < limit) {
    return searchConcept(type, qs, _existingResults);
  }

  return _existingResults.slice(0, limit);
}

async function ingestConcept(type, xml, identifierPath, provider, token) {
  // Accept either an XML file, or an XML string itself
  let xmlString = xml;
  if (fs.existsSync(xml)) {
    xmlString = fs.readFileSync(xml, 'utf8');
  }

  let xmlObject = await new Promise((resolve, reject) => {
    parseString(xmlString, xmlParseOptions, (err, obj) => {
      if (err) reject(err);
      resolve(obj);
    });
  });

  //log.debug('XML object parsed', logDetails);
  const identifier = property(identifierPath)(xmlObject);
  logDetails.granuleId = identifier;

  try {
    await validate(type, xmlString, identifier, provider);
    //log.debug('XML object is valid', logDetails);

    //log.info('Pushing xml metadata to CMR', logDetails);
    const response = await got.put(
      `${getUrl('ingest', provider)}${type}s/${identifier}`,
      {
        body: xmlString,
        headers: {
          'Echo-Token': token,
          'Content-type': 'application/echo10+xml'
        }
      }
    );

    //log.info('Metadata pushed to CMR.', logDetails);

    xmlObject = await new Promise((resolve, reject) => {
      parseString(response.body, xmlParseOptions, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });

    if (xmlObject.errors) {
      throw new Error(
        `Failed to ingest, CMR error message: ${JSON.stringify(xmlObject.errors.error)}`
      );
    }

    return xmlObject;
  }
  catch (e) {
    //log.error(e, logDetails);
    throw e;
  }
}

async function deleteConcept(type, identifier, provider, token) {
  const url = `${getUrl('ingest', provider)}${type}/${identifier}`;

  const response = await got.delete(url, {
    headers: {
      'Echo-Token': token,
      'Content-type': 'application/echo10+xml'
    }
  });

  const xmlObject = await new Promise((resolve, reject) => {
    parseString(response.body, xmlParseOptions, (err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });

  if (xmlObject.errors) {
    throw new Error(
      `Failed to delete, CMR error message: ${JSON.stringify(xmlObject.errors.error)}`
    );
  }

  return xmlObject;
}

class CMR {
  constructor(provider, clientId, username, password) {
    this.clientId = clientId;
    this.provider = provider;
    this.username = username;
    this.password = password;
  }

  async getToken() {
    return updateToken(this.provider, this.clientId, this.username, this.password);
  }

  async ingestCollection(xml) {
    const token = this.getToken();
    return ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, token);
  }

  async ingestGranule(xml) {
    const token = this.getToken();
    return ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, token);
  }

  async deleteCollection(datasetID) {
    return deleteConcept('collection', datasetID);
  }

  async deleteGranule(granuleUR) {
    const token = this.getToken();
    return deleteConcept('granules', granuleUR, this.provider, token);
  }

  async searchCollections(searchParams) {
    return searchConcept('collection', searchParams, []);
  }

  async searchGranules(searchParams) {
    return searchConcept('granule', searchParams, []);
  }
}

module.exports = {
  ingestConcept,
  getUrl,
  updateToken,
  ValidationError,
  CMR
};
