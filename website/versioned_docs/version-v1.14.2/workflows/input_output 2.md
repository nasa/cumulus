---
id: version-v1.14.2-input_output
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

A task's Lambda function can be configured to include a Cumulus Message Adapter library which constructs input/output messages and resolves task configurations.     The CMA can then be included in one of three ways:

#### Kes Injection

In the Lambda function configuration file lambdas.yml, a task Lambda function can be configured to include the latest CMA via kes.  Kes will download and include the latest CMA package in the Lambda that's uploaded to AWS:

```yaml
    DiscoverPdrs:
      handler: index.handler
      useMessageAdapter: true
```

Optionally you can configure kes to specify the version of the CMA to be used using the `message_adapter_version` configuration key:

```yaml
message_adapter_version: v1.0.13
```


#### Lambda Layer

In order to make use of this configuration, a Lambda layer can be uploaded to your account.  Due to platform restrictions, Core cannot currently support sharable public layers, however you can support deploying the appropriate version from [the release page](https://github.com/nasa/cumulus-message-adapter/releases) via the AWS [Layers Interface](https://console.aws.amazon.com/lambda/home?region=us-east-1#/layers), *or* the provided CMA [Terraform](https://www.terraform.io/) module located at [tf-modules/cumulus-message-adapter](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus-message-adapter).

Once you've deployed the layer, include the CMA in the configured Lambda layers:

```yaml
    DiscoverPdrs:
      layers:
        - arn:aws:lambda:us-east-1:{{AWS_ACCOUNT_ID}}:layer:Cumulus_Message_Adapter:{version number}
```

In the future if you wish to update/change the CMA version you will need to update the deployed CMA, and update the layer configuration for the impacted Lambdas as needed, or re-run the Terraform module.     If you have a large number of Lambdas utilizing the CMA, you can include a configuration key in your `config.yml`:

```yaml
    cma_layer: arn:aws:lambda:us-east-1:{{AWS_ACCOUNT_ID}}:layer:Cumulus_Message_Adapter:{version number}
```

and include the reference in the Lambda configuration:

```yaml
    DiscoverPdrs:
      layers:
        - '{{cma_layer}'
```

***Please Note***: Updating/removing a layer does not change a deployed Lambda, so to update the CMA you should deploy a new version of the CMA layer, update the associated Lambda configuration to reference the new CMA version, and re-deploy your Lambdas.

***Please Note***: Updating the CMA without updating the lambda code will fail if operating with the Workflow Lambda Versions feature enabled.  If you are utilizing this option, we recommend continuing use of kes injection/manual addition for now.

This method will be supported more fully once migration to Terraform Deployments has been completed.

#### Manual Addition

You can include the CMA package in the Lambda code in the `cumulus-message-adapter` sub-directory, this will achieve a similar result to kes injection, but will require manual updates to update the CMA code.

Cumulus will set a default `CUMULUS_MESSAGE_ADAPTER_DIR` environment variable to the `cmaDir` global configuration value, which defaults to `/opt/`.   If `useMessageAdapter: true` is set, it will set it to the `cumulus-message-adapter` directory.

If you are manually adding the message adapter to your source and utilizing the CMA, you should set the Lambda's `CUMULUS_MESSAGE_ADAPTER_DIR` environment variable to override this, or if you aren't utilizing the CMA layer, set the global `cmaDir` to the directory you're packaging your Lambda in.

### CMA Input/Output

Input to the task application code is a json object with keys:

* `input`: By default, the incoming payload is the payload output from the previous task, or it can be a portion of the payload as configured for the task in the corresponding `.yml` file in the `workflows` directory.
* `config`: Task-specific configuration object with URL templates resolved.

Output from the task application code is returned in and placed in the `payload` key by default, but the `config` key can also be used to return just a portion of the task output.


### CMA configuration

As of Cumulus > 1.15 and CMA > v1.1.1, configuration of the CMA is expected to be driven by AWS Step Function Parameters.

Using the CMA package with the lambda by by any of the above mentioned methods (Manual, Kes, Lambda Layers) requires configuration for it's various features via a specific Step Function Parameters configuration format:

```yaml
StepFunction:
  Parameters:
    cma:
      event.$: '$'
      configuration keys: ...
```

The `event.$: '$'` parameter is *required* as it passes the entire incoming message to the CMA client library for parsing, and the CMA itself to convert the incoming message into a Cumulus message for use in the function.

The following are the CMA's current configuration settings:

#### ReplaceConfig (Cumulus Remote Message)

Because of the potential size of a Cumulus message, mainly the `payload` field, a task can be set via configuration to store a portion of its output on S3 with a message key `Remote Message` that defines how to retrieve it and an empty JSON object `{}` in its place.   If the portion of the message targeted exceeds the configured `MaxSize` (defaults to 0 bytes) it will be written to S3.

The CMA remote message functionality can be configured using parameters in several ways:

##### Partial Message

Setting the `Path`/`Target` path in the `ReplaceConfig` parameter (and optionally a non-default `MaxSize`)

```yaml
DiscoverGranules:
  Parameters:
    cma:
      event.$: '$'
      ReplaceConfig:
        MaxSize: 1
        Path: '$.payload'
        TargetPath: '$.payload'
```

will result in any `payload` output larger than the `MaxSize` (in bytes) to be written to S3.  The CMA will then mark that the key has been replaced via a `replace` key on the event. When the CMA picks up the `replace` key in future steps, it will attempt to retrieve the output from S3 and write it back to `payload`.

Note that you can optionally use a different `TargetPath` than `Path`, however as the target is a JSON path there must be a key to target for replacement in the output of that step.    Also note that the JSON path specified must target *one* node, otherwise the CMA will error, as it does not support multiple replacement targets.

If `TargetPath` is omitted, it will default to the value for `Path`.

##### Full Message

Setting the following parameters for a lambda:

```yaml
DiscoverGranules:
  Parameters:
    cma:
      event.$: '$'
      ReplaceConfig:
        FullMessage: true
```

will result in the CMA assuming the entire inbound message should be stored to S3 if it exceeds the default max size.

This is effectively the same as doing:

```yaml
DiscoverGranules:
  Parameters:
    cma:
      event.$: '$'
      ReplaceConfig:
        MaxSize: 0
        Path: '$'
        TargetPath: '$'
```


##### Cumulus Message example:

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

##### Cumulus Remote Message example:

The message may contain a reference to an S3 Bucket, Key and TargetPath as follows:

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


#### task_config

This configuration key contains the input/output configuration values for definition of inputs/outputs via URL paths.
**Important**:  These values are all relative to json object configured for `event.$`.

This configuration's behavior is outlined in the CMA step description (Cumulus Message Adapter has the following steps) below.

The configuration should follow the format:

```yaml
FunctionName:
  Parameters:
    cma:
      event.$: '$'
      other_cma_configuration: '<config object>'
      task_config: '<task config>'

```

Example:

```yaml
StepFunction:
  Parameters:
    cma:
      event.$: '$'
      task_config:
        sfnEnd: true
        stack: '{$.meta.stack}'
        bucket: '{$.meta.buckets.internal.name}'
        stateMachine: '{$.cumulus_meta.state_machine}'
        executionName: '{$.cumulus_meta.execution_name}'
        cumulus_message:
          input: '{$}'
```

### Cumulus Message Adapter has the following steps:

#### 1. Reformat AWS Step Function message into Cumulus Message

Due to the way AWS handles Parmeterized messages, when Parameters are used the CMA takes an inbound message:

```json
{
  "resource": "arn:aws:lambda:us-east-1:<lambda arn values>",
  "input": {
    "Other Parameter": {},
    "cma": {
      "ConfigKey": {
        "config values": "some config values"
      },
      "event": {
        "cumulus_meta": {},
        "payload": {},
        "meta": {},
        "exception": {}
      }
    }
  }
}
```

and takes the following actions:

* Takes the object at `input.cma.event` and makes it the full input
* Merges all of the keys except `event` under `input.cma` into the parent input object

This results in the incoming message (presumably a Cumulus message) with any cma configuration parameters merged in being passed to the CMA.    *All other parameterized values defined outside of the `cma` key are ignored*


#### 2. Resolve Remote Messages

If the incoming Cumulus message has a `replace` key value, the CMA will attempt to pull the payload from S3,

For example, if the incoming contains the following:

```json
  "meta": {
    "foo": {}
  },
  "replace": {
    "TargetPath": "$.meta.foo",
    "Bucket": "some_bucket",
    "Key": "events/some-event-id"
  }
```

The CMA will attempt to pull the file stored at `Bucket`/`Key` and replace the value at `TargetPath`, then remove the `replace` object entirely and continue.


#### 3. Resolve URL templates in the task configuration

In the workflow configuration (defined under the `task_config` key), each task has its own configuration, and it can use URL template as a value to achieve simplicity or for values only available at execution time. The Cumulus Message Adapter resolves the URL templates (relative to the event configuration key) and then passes message to next task. For example, given a task which has the following configuration:

```yaml
    Discovery:
      Parameters:
        cma:
          event.$: '$'
          task_config:
            provider: '{$.meta.provider}'
              inlinestr: 'prefix{meta.foo}suffix'
              array: '{[$.meta.foo]}'
              object: '{$.meta}'
```

*and* and incoming message that contains:

```json
      "meta": {
        "foo": "bar",
        "provider": {
          "id": "FOO_DAAC",
          "anykey": "anyvalue"
        }
      }
```

The corresponding Cumulus Message would contain:

```yaml
    {
      "meta": {
        "foo": "bar",
        "provider": {
          "id": "FOO_DAAC",
          "anykey": "anyvalue"
        },
        ...
      },
      "task_config": {
        "provider: "{$.meta.provider}",
        "inlinestr": "prefix{meta.foo}suffix",
        "array": "{[$.meta.foo]}",
        "object": "{$.meta}"
        ...
      }
    }
```

The message sent to the task would be:

```yaml
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
```

URL template variables replace dotted paths inside curly brackets with their corresponding value. If the Cumulus Message Adapter cannot resolve a value, it will ignore the template, leaving it verbatim in the string.  While seemingly complex, this allows significant decoupling of Tasks from one another and the data that drives them. Tasks are able to easily receive runtime configuration produced by previously run tasks and domain data.

#### 4. Resolve task input

By default, the incoming payload is the payload from the previous task.  The task can also be configured to use a portion of the payload its input message.  For example, given a task specifies `cma.task_config.cumulus_message.input`:

```yaml
    ExampleTask:
      Parameters:
        cma:
          event.$: '$'
          task_config:
            cumulus_message:
                input: '{$.payload.foo}'
```

The task configuration in the message would be:

```json
    {
      "task_config": {
        "cumulus_message": {
          "input": "{$.payload.foo}"
        }
      },
      "payload": {
        "foo": {
          "anykey": "anyvalue"
        }
      }
    }
```

The Cumulus Message Adapter will resolve the task input, instead of sending the whole `payload` as task input, the task input would be:

```yaml
    {
      "input" : {
        "anykey": "anyvalue"
      },
      "config": {...}
    }
```

#### 5. Resolve task output

By default, the task's return value is the next payload.  However, the workflow task configuration can specify a portion of the return value as the next payload, and can also augment values to other fields. Based on the task configuration under `cma.task_config.cumulus_message.outputs`, the Message Adapter uses a task's return value to output a message as configured by the task-specific config defined under `cma.task_config`. The Message Adapter dispatches a "source" to a "destination" as defined by URL templates stored in the task-specific `cumulus_message.outputs`. The value of the task's return value at the "source" URL is used to create or replace the value of the task's return value at the "destination" URL. For example, given a task specifies cumulus_message.output in its workflow configuration as follows:

```yaml
    ExampleTask:
      Parameters:
        cma:
          event.$: '$'
          task_config:
            cumulus_message:
                outputs:
                  - source: '{$}'
                    destination: '{$.payload}'
                  - source: '{$.output.anykey}'
                    destination: '{$.meta.baz}'
```

The corresponding Cumulus Message would be:

```json
    {
      "task_config": {
        "cumulus_message": {
          "outputs": [
            {
              "source": "{$}",
              "destination": "{$.payload}"
            },
            {
              "source": "{$.output.anykey}",
              "destination": "{$.meta.baz}"
            }
          ]
        }
      },
      "meta": {
        "foo": "bar"
      },
      "payload": {
        "anykey": "anyvalue"
      }
    }
```

Given the response from the task is:

```json
    {
      "output": {
          "anykey": "boo"
      }
    }
```

The Cumulus Message Adapter would output the following Cumulus Message:

```json
    {
      "task_config": {
          "cumulus_message": {
            "outputs": [
              {
                "source": "{$}",
                "destination": "{$.payload}"
              },
              {
                "source": "{$.output.anykey}",
                "destination": "{$.meta.baz}"
              }
            ]
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
```

#### 6. Apply Remote Message Configuration

If the `ReplaceConfig` configuration parameter is defined, the CMA will evaluate the configuration options provided, and if required write a portion of the Cumulus Message to S3, and add a `replace` key to the message for future steps to utilize.

***Please Note***: the non user-modifiable field `cumulus-meta` will always be retained, regardless of the configuration.


For example, if the output message (post output configuration) from a cumulus message looks like:

```json
    {
      "cumulus_meta": {
        "some_key": "some_value"
      },
      "ReplaceConfig": {
        "FullMessage": true
      },
      "task_config": {
        "cumulus_message": {
          "outputs": [
            {
              "source": "{$}",
              "destination": "{$.payload}"
            },
            {
              "source": "{$.output.anykey}",
              "destination": "{$.meta.baz}"
            }
          ]
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
```

the resultant output would look like:

```json
{
  "cumulus_meta": {
    "some_key": "some_value"
  },
  "replace": {
    "TargetPath": "$",
    "Bucket": "some-internal-bucket",
    "Key": "events/some-event-id"
  }
}
```

### Additional Features:
#### Validate task input, output and configuration messages against the schemas provided.

The Cumulus Message Adapter has the capability to validate task input, output and configuration messages against their schemas.  The default location of the schemas is the schemas folder in the top level of the task and the default filenames are input.json, output.json, and config.json. The task can also configure a different schema location.  If no schema can be found, the Cumulus Message Adapter will not validate the messages.
