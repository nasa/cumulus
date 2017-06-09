'use strict';

const { parseCollectionYaml, ingestStackResourceResolver } = require('../app/collection-config');
const fs = require('fs');
const { fromJS } = require('immutable');

const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

describe('parseCollectionYaml', () =>
  it('parse sample yaml', () => {
    const ingestStackResources = fromJS(JSON.parse(
      fs.readFileSync('./test/mock-ingest-resources.json')));
    const resolver = ingestStackResourceResolver(ingestStackResources, 'gitcxtstxx');

    const sampleCollYaml = fs.readFileSync('./test/sample-collections.yml', 'UTF-8');
    const sampleParsedColl = JSON.parse(fs.readFileSync('./test/sample-collections.json', 'UTF-8'));
    const parsed = parseCollectionYaml(sampleCollYaml, resolver);
    expect(parsed.toJS()).to.eql(sampleParsedColl);
  })
);

