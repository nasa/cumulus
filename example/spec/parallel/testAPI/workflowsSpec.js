'use strict';

const { getWorkflow, getWorkflows } = require('@cumulus/api-client/workflows');

const { loadConfig } = require('../../helpers/testUtils');

describe('GET /workflows', () => {
  it('returns a list of workflows', async () => {
    const config = await loadConfig();

    const response = await getWorkflows({ prefix: config.stackName });

    expect(response.statusCode).toBe(200);

    const workflows = JSON.parse(response.body);

    expect(workflows).toBeInstanceOf(Array);
    expect(workflows.length).toBeGreaterThan(0);
  });
});

describe('GET /workflow', () => {
  it('returns the requested workflow', async () => {
    const config = await loadConfig();

    const response = await getWorkflow({
      prefix: config.stackName,
      workflowName: 'HelloWorldWorkflow',
    });

    expect(response.statusCode).toBe(200);

    const workflow = JSON.parse(response.body);

    expect(workflow).toBeInstanceOf(Object);
    expect(workflow.name).toBe('HelloWorldWorkflow');
  });
});
