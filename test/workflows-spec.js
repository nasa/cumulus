'use strict';

const workflows = require('../app/workflows');
const fs = require('fs');
const aws = require('../app/aws');

const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const makePromiseResponse = (data) => {
  const p = new Promise(
    (resolve, _reject) => resolve(data)
  );
  return { promise: () => p };
};

/**
 * Provides an implementation of s3 that returns canned data.
 * This only implements functions needed for testing. Add more as needed.
 */
class FakeS3 {
  constructor(data) {
    this.data = data;
  }

  getObject({ Bucket, Key }) {
    return makePromiseResponse({ Body: this.data[Bucket][Key] });
  }
}


/**
 * Provides an implementation of step functions that returns canned data.
 * This only implements functions needed for testing. Add more as needed.
 */
class FakeStepFunctions {

  /**
   * constructor
   *
   * @param stateMachines     A list of statemachines to return if called
   * @param smArnToExecutions A map of statemachine ARNs to executions.
   */
  constructor(stateMachines, smArnToExecutions) {
    this.stateMachines = stateMachines;
    this.smArnToExecutions = smArnToExecutions;
  }

  listStateMachines() {
    return makePromiseResponse({ stateMachines: this.stateMachines });
  }

  listExecutions({ stateMachineArn, maxResults = 1000 }) {
    const executions = this.smArnToExecutions[stateMachineArn];
    return makePromiseResponse({ executions: executions.slice(0, maxResults) });
  }
}

// A very simple collections yaml with two workflows.
const simpleCollYaml = `
workflows:
  DiscoverVIIRS:
    Comment: VIIRS Discovery
  IngestVIIRS:
    Comment: VIIRS Ingest
`;

const mockS3 = new FakeS3({ 'sf-Stack-deploy': { 'ingest/collections.yml': simpleCollYaml } });

const mockSF = new FakeStepFunctions(
  // A set of statemachines that will be returned.
  [{ name: 'sfdifferent', stateMachineArn: 'ignored' },
   { name: 'sfxStackxxDiscoverVIIRS-1234', stateMachineArn: 'discover-viirs-arn' },
   { name: 'sfxStackxxIngestVIIRS-1234', stateMachineArn: 'ingest-viirs-arn' }],

  // A map of step function statemachine arn to executions.
  { 'discover-viirs-arn': [{ status: 'SUCCEEDED', startDate: '2012', stopDate: '2013' },
                           { status: 'ABORTED', startDate: '2012', stopDate: '2013' },
                           { status: 'RUNNING', startDate: '2012' },
                           { status: 'SUCCEEDED', startDate: '2012', stopDate: '2013' }],
    'ingest-viirs-arn': [{ status: 'RUNNING', startDate: '2014' },
                         { status: 'SUCCEEDED', startDate: '2012', stopDate: '2013' }] }
);

const expectedStatuses = [
  { id: 'DiscoverVIIRS',
    name: 'VIIRS Discovery',
    executions: [{ status: 'SUCCEEDED', start_date: '2012', stop_date: '2013' },
                 { status: 'ABORTED', start_date: '2012', stop_date: '2013' }] },
  { id: 'IngestVIIRS',
    name: 'VIIRS Ingest',
    executions: [{ status: 'RUNNING', start_date: '2014' },
                 { status: 'SUCCEEDED', start_date: '2012', stop_date: '2013' }] }
];

describe('getWorkflowStatuses', () => {
  before((done) => {
    aws.useReplacementServices({ s3: mockS3, stepFunctions: mockSF });
    done();
  });

  after((done) => {
    aws.useRealServices();
    done();
  });

  it('find correct executions', () =>
    expect(workflows.getWorkflowStatuses('sf-Stack', 2)).to.eventually.deep.eq(expectedStatuses)
  );
});

describe('parseCollectionYaml', () =>
  it('parse sample yaml', () => {
    const sampleCollYaml = fs.readFileSync('./test/sample-collections.yml', 'UTF-8');
    const sampleParsedColl = JSON.parse(fs.readFileSync('./test/sample-collections.json', 'UTF-8'));
    const parsed = workflows.parseCollectionYaml(sampleCollYaml);
    expect(parsed.toJS()).to.eql(sampleParsedColl);
  })
);

