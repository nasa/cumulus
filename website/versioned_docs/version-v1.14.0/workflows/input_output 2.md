---
id: version-v1.14.0-input_output
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
        - '{{cma_layer}}'
```

***Please note***: Updating/removing a layer does not change a deployed Lambda, so to update the CMA you should deploy a new version of the CMA layer, update the associated Lambda configuration to reference the new CMA version, and re-deploy your Lambdas.

**Please Note**: Updating the CMA without updating the lambda code will fail if operating with the Workflow Lambda Versions feature enabled.  If you are utilizing this option, we recommend continuing use of kes injection/manual addition for now.

This method will be supported more fully once migration to Terraform Deployments has been completed.

#### Manual Addition

You can include the CMA package in the Lambda code in the `cumulus-message-adapter` sub-directory, this will achieve a similar result to kes injection, but  will require manual updates to update the CMA code.

Cumulus will set a default `CUMULUS_MESSAGE_ADAPTER_DIR` environment variable to the `cmaDir` global configuration value, which defaults to `/opt/`.   If `useMessageAdapter: true` is set, it will set it to the `cumulus-message-adapter` directory.

If you are manually adding the message adapter to your source and utilizing the CMA, you should set the Lambda's `CUMULUS_MESSAGE_ADAPTER_DIR` environment variable to override this, or if you aren't utilizing the CMA layer, set the global `cmaDir` to the directory you're packaging your Lambda in.

### CMA Input/Output

Input to the task application code is a json object with keys:

* `input`: By default, the incoming payload is the payload output from the previous task, or it can be a portion of the payload as configured for the task in the corresponding `.yml` file in the `workflows` directory.
* `config`: Task-specific configuration object with URL templates resolved.

Output from the task application code is returned in and placed in the `payload` key by default, but the `config` key can also be used to return just a portion of the task output.

### Cumulus Message Adapter has the following steps:

#### 1. Resolve URL templates in the task configuration

In the workflow configuration, each task has its own configuration, and it can use URL template as a value to achieve simplicity or for values only available at execution time. The Cumulus Message Adapter resolves the URL templates and then passes message to next task. For example, given a task which has the following configuration:

```yaml
    Discovery:
        CumulusConfig:
          provider: '{$.meta.provider}'
          inlinestr: 'prefix{meta.foo}suffix'
          array: '[$.meta.foo]'
          object: '{$.meta}'
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

#### 2. Resolve task input

By default, the incoming payload is the payload from the previous task.  The task can also be configured to use a portion of the payload its input message.  For example, given a task specifies cumulus_message.input:

```yaml
    ExampleTask:
      CumulusConfig:
        cumulus_message:
            input: '{$.payload.foo}'
```

The task configuration in the message would be:

```yaml
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
```

The Cumulus Message Adapter will resolve the task input, instead of sending the whole `"payload"` as task input, the task input would be:

```yaml
    {
      "input" : {
        "anykey": "anyvalue"
      },
      "config": {...}
    }
```

#### 3. Resolve task output

By default, the task's return value is the next payload.  However, the workflow task configuration can specify a portion of the return value as the next payload, and can also augment values to other fields. Based on the task configuration under `cumulus_message.outputs`, the Message Adapter uses a task's return value to output a message as configured by the task-specific config defined under `workflow_config`. The Message Adapter dispatches a "source" to a "destination" as defined by URL templates stored in the task-specific `cumulus_message.outputs`. The value of the task's return value at the "source" URL is used to create or replace the value of the task's return value at the "destination" URL. For example, given a task specifies cumulus_message.output in its workflow configuration as follows:

```yaml
    ExampleTask:
      CumulusConfig:
        cumulus_message:
            outputs:
              - source: '{$}'
                destination: '{$.payload}'
              - source: '{$.output.anykey}'
                destination: '{$.meta.baz}'
```

The corresponding Cumulus Message would be:

```yaml
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
```

Given the response from the task is:

```yaml
    {
      "output": {
          "anykey": "boo"
      }
    }
```

The Cumulus Message Adapter would output the following Cumulus Message:

```yaml
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
```

#### 4. Validate task input, output and configuration messages against the schemas provided.

The Cumulus Message Adapter has the capability to validate task input, output and configuration messages against their schemas.  The default location of the schemas is the schemas folder in the top level of the task and the default filenames are input.json, output.json, and config.json. The task can also configure a different schema location.  If no schema can be found, the Cumulus Message Adapter will not validate the messages.
