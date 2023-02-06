---
id: version-v3.0.0-workflow-add-new-lambda
title: Workflow - Add New Lambda
hide_title: false
original_id: workflow-add-new-lambda
---

You can develop a workflow task in AWS Lambda or Elastic Container Service (ECS). AWS ECS requires Docker. For a list of tasks to use go to our [Cumulus Tasks page](../tasks).

The following steps are to help you along as you write a new Lambda that integrates with a Cumulus workflow. This will aid you with the understanding of the [Cumulus Message Adapter (CMA)](https://github.com/nasa/cumulus-message-adapter) process.

## Steps

1. Define New Lambda in Terraform

2. Add Task in JSON Object

    For details on how to set up a workflow via CMA go to the [CMA Tasks: Message Flow](../workflows/cumulus-task-message-flow).

    You will need to assign input and output for the new task and follow the CMA contract [here](https://github.com/nasa/cumulus-message-adapter/blob/master/CONTRACT.md). This contract defines how libraries should call the cumulus-message-adapter to integrate a task into an existing Cumulus Workflow.

3. Verify New Task

    Check the updated workflow in AWS and in Cumulus.
