---
id: version-v1.10.1-input_output
title: Workflows Input & Output
hide_title: true
original_id: input_output
---

# Ingest Inputs and Return Values

## General Structure

Cumulus uses a common format for all inputs and outputs to workflows. The same format is used for input and output from workflow steps. The common format consists of a JSON object which holds all necessary information about the task execution and AWS environment. Tasks return objects identical in format to their input with the exception of a task-specific `payload` field. Tasks may also augment their execution metadata.

## Cumulus Message Adapter

The Cumulus Message Adapter and Cumulus Message Adapter libraries help task developers integrate their tasks into a Cumulus workflow. These libraries adapt input and outputs from tasks into the Cumulus Message format. The Scheduler service creates the initial event message by combining the collection configuration, external resource configuration, workflow configuration, and deployment environment settings.  The subsequent workflow messages between tasks must conform to the message schema. By using the Cumulus Message Adapter, individual task Lambda functions only receive the input and output specifically configured for the task, and not non-task-related message fields.

The Cumulus Message Adapter libraries are called by the tasks with a callback function containing the business logic of the task as a parameter. They first adapt the incoming message to a format more easily consumable by Cumulus tasks, then invoke the task, and then adapt the task response back to the Cumulus message protocol to be sent to the next task.

A task's Lambda function can be configured to include a Cumulus Message Adapter library which constructs input/output messages and resolves task configurations. In the Lambda function configuration file lambdas.yml, a task Lambda function can be configured to use Cumulus Message Adapter, for example:

    DiscoverPdrs:
      handler: index.handler
      useMessageAdapter: true

Input to the task application code is a json object with keys:
* `input`: By default, the incoming payload is the payload output from the previous task, or it can be a portion of the payload as configured for the task in the corresponding `.yml` file in the `workflows` directory.
* `config`: Task-specific configuration object with URL templates resolved.

Output from the task application code is returned in and placed in the `payload` key by default, but the `config` key can also be used to return just a portion of the task output.

### Cumulus Message Adapter has the following steps:

#### 1. Resolve URL templates in the task configuration

In the workflow configuration, each task has its own configuration, and it can use URL template as a value to achieve simplicity or for values only available at execution time. The Cumulus Message Adapter resolves the URL templates and then passes message to next task. For example, given a task which has the following configuration:

    Discovery:
        CumulusConfig:
          provider: '{$.meta.provider}'
          inlinestr: 'prefix{meta.foo}suffix'
          array: '[$.meta.foo]'
          object: '{$.meta}'

The corresponding Cumulus Message would contain:

    {
      "meta": {
        "foo": "bar",
        "provider": {
          "id": "FOO_DAAC",
          "anykey": "anyvalue"
        },
        ...
      },
      "workflow_config": {
        "Discovery": {
          "provider: "{{$.meta.provider}}",
          "inlinestr": "prefix{meta.foo}suffix",
          "array": "{[$.meta.foo]}",
          "object": "{{$.meta}}"
        },
        ...
      }
    }

The message sent to the task would be:

    {
      "config" : {
        "provider: {
          "id": "FOO_DAAC",
          "anykey": "anyvalue"
        },
        "inlinestr": "prefixbarsuffix",
        "array": ["bar"]
        "object": {
          "foo": "bar",
          "provider": {
            "id": "FOO_DAAC",
            "anykey": "anyvalue"
           },
           ...
        },
      },
      "input":{...}
    }

URL template variables replace dotted paths inside curly brackets with their corresponding value. If the Cumulus Message Adapter cannot resolve a value, it will ignore the template, leaving it verbatim in the string.  While seemingly complex, this allows significant decoupling of Tasks from one another and the data that drives them. Tasks are able to easily receive runtime configuration produced by previously run tasks and domain data.

#### 2. Resolve task input

By default, the incoming payload is the payload from the previous task.  The task can also be configured to use a portion of the payload its input message.  For example, given a task specifies cumulus_message.input:

    ExampleTask:
      CumulusConfig:
        cumulus_message:
            input: '{$.payload.foo}'

The task configuration in the message would be:

    {
      "workflow_config": {
        "ExampleTask": {
          "cumulus_message": {
            "input": "{{$.payload.foo}}"
          }
        }
      },
      "payload": {
        "foo": {
          "anykey": "anyvalue"
        }
      }
    }

The Cumulus Message Adapter will resolve the task input, instead of sending the whole `"payload"` as task input, the task input would be:

    {
      "input" : {
        "anykey": "anyvalue"
      },
      "config": {...}
    }

#### 3. Resolve task output

By default, the task's return value is the next payload.  However, the workflow task configuration can specify a portion of the return value as the next payload, and can also augment values to other fields. Based on the task configuration under `cumulus_message.outputs`, the Message Adapter uses a task's return value to output a message as configured by the task-specific config defined under `workflow_config`. The Message Adapter dispatches a "source" to a "destination" as defined by URL templates stored in the task-specific `cumulus_message.outputs`. The value of the task's return value at the "source" URL is used to create or replace the value of the task's return value at the "destination" URL. For example, given a task specifies cumulus_message.output in its workflow configuration as follows:

    ExampleTask:
      CumulusConfig:
        cumulus_message:
            outputs:
              - source: '{$}'
                destination: '{$.payload}'
              - source: '{$.output.anykey}'
                destination: '{$.meta.baz}'

The corresponding Cumulus Message would be:

    {
      "workflow_config": {
        "ExampleTask": {
          "cumulus_message": {
            "outputs": [
              {
                "source": "{{$}}",
                "destination": "{{$.payload}}"
              },
              {
                "source": "{{$.output.anykey}}",
                "destination": "{{$.meta.baz}}"
              }
            ]
          }
        }
      },
      "meta": {
        "foo": "bar"
      },
      "payload": {
        "anykey": "anyvalue"
      }
    }

Given the response from the task is:

    {
      "output": {
          "anykey": "boo"
      }
    }

The Cumulus Message Adapter would output the following Cumulus Message:

    {
      "workflow_config": {
        "ExampleTask": {
          "cumulus_message": {
            "outputs": [
              {
                "source": "{{$}}",
                "destination": "{{$.payload}}"
              },
              {
                "source": "{{$.output.anykey}}",
                "destination": "{{$.meta.baz}}"
              }
            ]
          }
        }
      },
      "meta": {
        "foo": "bar",
        "baz": "boo"
      },
      "payload": {
        "output": {
          "anykey": "boo"
        }
      }
    }

#### 4. Validate task input, output and configuration messages against the schemas provided.

The Cumulus Message Adapter has the capability to validate task input, output and configuration messages against their schemas.  The default location of the schemas is the schemas folder in the top level of the task and the default filenames are input.json, output.json, and config.json. The task can also configure a different schema location.  If no schema can be found, the Cumulus Message Adapter will not validate the messages.

## Common Data Types

### Remote Urls

Input to: sync-http-urls

Returned by: discover-http-tiles, sync-wms

    // Array of remote URLs
    {
         "url": "<string>",     // A single remote URL
         "version": "<string>"  // An opaque string that identifies the remote file version.
                                // This can be used to allow re-fetching of remote resources if
                                // the change but still have the same URL
    },
    ...                         // Potentially more URLs

### S3 Objects

Produced by: sync-http-urls

Input to: generate-mrf

    // Array of S3 objects
    {
        "Bucket": "<string>",  // The S3 bucket. The key's case convention is broken to
                               // maintain consistency with the S3 SDK/API. These objects
                               // can (and should) be passed verbatim to the SDK.
        "Key": "<string>"      // The S3 object's key.
    }
    ...                        // Potentially more objects
