const { Lambda } = require('aws-sdk');
const { loadConfig } = require('../helpers/testUtils');

const config = loadConfig();

/**
 * Calls the s3AccessTest lambda in the given region, which returns
 * true or false based on whether test s3 object can be accessed from the 
 * lambda
 * 
 * @param {string} region - AWS region
 * @returns {string} - 'true' or 'false'
 */
async function canAccessObject(region) {
  const lambda = new Lambda({ region });

  const data = await lambda.invoke({ 
    FunctionName: `${config.stackName}-S3AccessTest`, 
    Payload: JSON.stringify({ Bucket: 'cumulus-test-s3-prototype', Key: 'test.txt' }) 
  }).promise();

  return data.Payload;
}

describe('The S3 bucket', function() {

  it('is accessible from us-east-1', async function() {
    expect(await canAccessObject('us-east-1')).toEqual('true');
  });

  it('is not accessible from us-west-1', async function() {
    expect(await canAccessObject('us-west-1')).toEqual('false');
  });
});