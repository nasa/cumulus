const { loadConfig } = require('../../helpers/testUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The aws_api_proxy deployed within a Cumulus workflow', () => {
  let workflowExecution;
  let snsName;
  let config;
  const snsMessage = { a: 'b' };
  const workflowName = 'AwsApiProxyWorkflow';

  beforeAll(async () => {
    config = await loadConfig();
    snsName = `${config.stackName}-test-sns-topic`;

    // Create an SNS topic for the workflow to publish to
    const sns = new config.AWS.SNS();
    const createTopicResponse = await sns.createTopic({ Name: snsName }).promise();

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      {
        test_task_config: {
          sns_message: snsMessage,
          sns_topic_arn: createTopicResponse.TopicArn,
        },
      },
      config.provider,
      config.payload
    );
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('completed');
  });

  it('successfully publishes a message to the SNS topic', () => {
    const returnedSnsMessage = workflowExecution.output.snsMessage;
    expect(returnedSnsMessage).toEqual(snsMessage);
  });

  afterAll(async () => {
    const sns = new config.AWS.SNS();
    await sns.deleteTopic({ Name: snsName }).promise();
  });
});
