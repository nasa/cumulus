'use strict';

const ea = require('../app/execution-aggregator');
const fs = require('fs');

const chai = require('chai');
const expect = chai.expect;

describe('parseElasticResponse', () =>
  it('parse sample yaml', () => {
    const resp = JSON.parse(fs.readFileSync('./test/sample-workflow-es-resp.json'));
    const workflows = JSON.parse(fs.readFileSync('./test/sample-workflow-parsed.json'));
    const parsed = ea.parseElasticResponse(resp);
    expect(parsed).to.eql(workflows);
  })
);

describe('parseCollectionSearchResponse', () =>
  it('parse sample yaml', () => {
    const resp = JSON.parse(fs.readFileSync('./test/sample-products-es-resp.json'));
    const productStatus = JSON.parse(fs.readFileSync('./test/sample-products-parsed.json'));
    const parsed = ea.parseCollectionSearchResponse(resp);
    expect(parsed).to.eql(productStatus);
  })
);
