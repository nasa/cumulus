'use strict';

const workflows = require('../app/workflows');
const fs = require('fs');

const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

describe('parseCollectionYaml', () =>
  it('parse sample yaml', () => {
    const sampleCollYaml = fs.readFileSync('./test/sample-collections.yml', 'UTF-8');
    const sampleParsedColl = JSON.parse(fs.readFileSync('./test/sample-collections.json', 'UTF-8'));
    const parsed = workflows.parseCollectionYaml(sampleCollYaml);
    expect(parsed.toJS()).to.eql(sampleParsedColl);
  })
);

