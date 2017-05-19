'use strict';

const wa = require('../app/workflow-aggregator');
const fs = require('fs');

const chai = require('chai');
const expect = chai.expect;

describe('parseElasticResponse', () =>
  it('parse sample yaml', () => {
    const resp = JSON.parse(fs.readFileSync('./test/sample-workflow-es-resp.json'));
    const workflows = JSON.parse(fs.readFileSync('./test/sample-workflow-parsed.json'));
    const parsed = wa.parseElasticResponse(resp);
    expect(parsed).to.eql(workflows);
  })
);
