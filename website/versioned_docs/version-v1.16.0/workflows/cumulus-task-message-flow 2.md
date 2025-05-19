---
id: version-v1.16.0-cumulus-task-message-flow
title: Cumulus Tasks: Message Flow
hide_title: true
original_id: cumulus-task-message-flow
---

# Cumulus Tasks: Message Flow

Cumulus Tasks comprise Cumulus Workflows and are either AWS Lambda tasks or AWS Elastic Container Service (ECS) activities. Cumulus Tasks permit a payload as input to the main task application code. The task payload is additionally wrapped by the [Cumulus Message Adapter](https://github.com/nasa/cumulus-message-adapter). The Cumulus Message Adapter supplies additional information supporting message templating and metadata management of these workflows.

![Diagram showing how incoming and outgoing Cumulus messages for workflow steps are handled by the Cumulus Message Adapter](assets/cumulus-task-message-flow.png)

The steps in this flow are detailed in sections below.

## Cumulus Message Format

A full **Cumulus Message** has the following keys:

* **`cumulus_meta`:** System runtime information that should generally not be touched outside of Cumulus library code or the Cumulus Message Adapter. Stores meta information about the workflow such as the state machine name and the current workflow execution's name. This information is used to look up the current active task. The name of the current active task is used to look up the corresponding task's config in `task_config`.
* **`meta`:** Runtime information captured by the workflow operators. Stores execution-agnostic variables.
* **`payload`:** Payload is runtime information for the tasks.

In adddition to the above keys, it *may* contain the following keys:

* **`replace`:** A key generated in conjunction with the Cumulus Message adapter.  It contains the location on S3 for a message payload and a Target JSON path in the message to extract it to.
* **`exception`:** A key used to track workflow exceptions, should not be modified outside of Cumulus library code.

Here's a simple example of a Cumulus Message:

```json
{
  "task_config": {
    "inlinestr": "prefix{meta.foo}suffix",
    "array": "{[$.meta.foo]}",
    "object": "{$.meta}"
  },
  "cumulus_meta": {
    "message_source": "sfn",
    "state_machine": "arn:aws:states:us-east-1:1234:stateMachine:MySfn",
    "execution_name": "MyExecution__id-1234",
    "id": "id-1234"
  },
  "meta": {
    "foo": "bar"
  },
  "payload": {
    "anykey": "anyvalue"
  }
}
```

A message utilizing the Cumulus Remote message functionality must have at least the keys `replace` and `cumulus_meta`.   Depending on configuration other portions of the message may be present, however the `cumulus_meta`, `meta`, and `payload` keys must be present once extraction is complete.

```json
{
  "replace": {
    "Bucket": "cumulus-bucket",
    "Key": "my-large-event.json",
    "TargetPath": "$"
  },
  "cumulus_meta": {}
}
```

## Cumulus Message Preparation

The event coming into a Cumulus Task is assumed to be a Cumulus Message and should first be handled by the functions described below before being passed to the task application code.

### Preparation Step 1: Fetch remote event

Fetch remote event will fetch the full event from S3 if the cumulus message includes a `replace` key.

Once "my-large-event.json" is fetched from S3, it's returned from the fetch remote event function. If no "replace" key is present, the event passed to the fetch remote event function is assumed to be a complete Cumulus Message and returned as-is.

#### Preparation Step 2: Parse step function config from CMA configuration parameters

This step  determines what current task is being executed. Note this is different from what lambda or activity is being executed, because the same lambda or activity can be used for different tasks. The current task name is used to load the appropriate configuration from the Cumulus Message's 'task_config' configuration parameter.

#### Preparation Step 3: Load nested event

Using the config returned from the previous step, load nested event resolves
templates for the final config and input to send to the task's application code.

## Task Application Code

After message prep, the message passed to the task application code is of the form:

```json
{
  "input": {},
  "config": {}
}
```

## Create Next Message functions

Whatever comes out of the task application code is used to construct an outgoing Cumulus Message.

### Create Next Message Step 1: Assign outputs

The config loaded from the **Fetch step function config** step may have a `cumulus_message` key. This can be used to "dispatch" fields from the task's application output to a destination in the final event output (via URL templating). Here's an example where the value of `input.anykey` would be dispatched as the value of `payload.out` in the final cumulus message:

```json
{
  "task_config": {
    "bar": "baz",
    "cumulus_message": {
      "input": "{$.payload.input}",
      "outputs": [
        {
          "source": "{$.input.anykey}",
          "destination": "{$.payload.out}"
        }
      ]
    }
  },
  "cumulus_meta": {
    "task": "Example",
    "message_source": "local",
    "id": "id-1234"
  },
  "meta": {
    "foo": "bar"
  },
  "payload": {
    "input": {
      "anykey": "anyvalue"
    }
  }
}
```

#### Create Next Message Step 2: Store remote event

 If the `ReplaceConfiguration` parameter is set, the configured key's value  will be stored in S3 and the final output of the task will include a `replace` key that contains configuration for a future step to extract the payload on S3 back into the Cumulus Message.   The `replace` key identifies where the large event node has been stored in S3.
