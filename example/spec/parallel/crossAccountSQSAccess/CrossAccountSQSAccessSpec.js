'use strict';

const {
  SQSClient,
  SendMessageCommand,
} = require('@aws-sdk/client-sqs');

const {
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');

const rulesApi = require('@cumulus/api-client/rules');
const Logger = require('@cumulus/logger');

const {
  loadConfig,
  timestampedName,
} = require('../../helpers/testUtils');

const SetupError = new Error('Test setup failed');
const log = new Logger({
  sender: '@cumulus/message/StepFunctions',
});

describe('Create SQS rule that exists in a cross-account configuration via the Cumulus API', () => {
  let config;
  let sqsClient;
  let queueUrl; // Assumes this is created or retrieved prior to the rule creation
  let sqsRule;
  let fetchedRule;
  let execution;
  let expectedPayload;
  let beforeAllError;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      process.env.stackName = config.stackName;

      sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
      queueUrl = 'https://sqs.us-east-1.amazonaws.com/226009925001/cumulus-sandbox-cross-account-sqsTestQueue';

      log.debug(`Referencing cross-account SQS queue: ${queueUrl}`);

      // 1. Create a Cumulus Rule that uses this cross-account SQS queue
      const sqsRuleName = timestampedName('CrossAccountSqsRule');
      sqsRule = {
        name: sqsRuleName,
        workflow: 'HelloWorldWorkflow',
        rule: {
          type: 'sqs',
          value: queueUrl, // Pointing the rule to our cross-account queue
        },
        meta: {
          description: 'Testing cross-account SQS queue trigger configuration',
        },
      };

      // Post the rule to the Cumulus API
      await rulesApi.postRule({
        prefix: config.stackName,
        rule: sqsRule,
      });

      // Fetch the rule to verify it was configured correctly'
      fetchedRule = await rulesApi.getRule({
        prefix: config.stackName,
        ruleName: sqsRule.name,
      });
      expect(fetchedRule.statusCode).toEqual(200);
      fetchedRule = JSON.parse(fetchedRule.body);

      expectedPayload = {
        testId: timestampedName('SQSMessageId'),
        message: 'Hello from cross-account test message!',
      };

      log.debug(`Sending message to queue ${queueUrl}`);
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(expectedPayload),
      }));

      // 3. Wait for the workflow execution triggered by the SQS message
      log.debug(`Waiting for execution of ${sqsRule.workflow} triggered by SQS message`);

      execution = await waitForTestExecutionStart({
        workflowName: sqsRule.workflow,
        stackName: config.stackName,
        bucket: config.bucket,
        findExecutionFn: (executionToCheck, params) => {
          const payloadString = JSON.stringify(executionToCheck);
          return payloadString.includes(params.testId);
        },
        findExecutionFnParams: { testId: expectedPayload.testId },
        startTask: 'HelloWorld',
      });
    } catch (error) {
      console.error('Error in beforeAll:', error);
      beforeAllError = error;
    }
  });

  beforeEach(() => {
    if (beforeAllError) fail(beforeAllError);
  });

  afterAll(async () => {
    // Clean up Cumulus Rule
    if (sqsRule && sqsRule.name) {
      log.debug(`Deleting rule ${sqsRule.name}`);
      await rulesApi.deleteRule({
        prefix: config.stackName,
        ruleName: sqsRule.name,
      }).catch(console.error);
    }
  });

  it('successfully creates the SQS rule pointing to the cross-account queue URL', () => {
    if (beforeAllError) throw SetupError;

    expect(fetchedRule).toBeDefined();
    expect(fetchedRule.name).toEqual(sqsRule.name);
    expect(fetchedRule.rule.type).toEqual('sqs');
    expect(fetchedRule.rule.value).toEqual(queueUrl);
  });

  it('triggers a workflow execution because of the message placed on the cross account queue', () => {
    if (beforeAllError) throw SetupError;

    expect(execution).toBeDefined();
    expect(execution.executionArn).toBeDefined();

    // Verify it ran the expected workflow
    expect(execution.stateMachineArn.split('-').at(-1)).toEqual(sqsRule.workflow);

    // // As a double check, verify our specific test payload ID made it into the execution record
    // const executionStr = JSON.stringify(execution);
    // expect(executionStr.includes(expectedPayload.testId)).toBeTrue();
  });
});
