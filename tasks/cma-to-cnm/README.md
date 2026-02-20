# @cumulus/granule-to-cnm

This lambda function converts Cloud Notification Mechanism format to CMA message
format.

CNM schema is defined in schemas/input.json
payload file schema defined in schema/output.json
## Message configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

The following table describes the properties of the configuration object. Note that the top-level object requires both provider and collection to be valid.

| field name                   | type   | default| required | description                                           |
|------------------------------|--------|--------|----------|-------------------------------------------------------|
| provier                      | Object | None   | Y        | Data source provider                                  |
| provider.id                  | string | None   | Y        | (Required)he unique identifier for the provider.      |
| provider.protocol            | string | None   | N        | The transfer protocol used (e.g.s3, ftp, http).       |
| provider.host                | string | None   | N        | The network host address for the provider.            |
| collection                   | object | None   | Y        | Contains metadata regarding the data collection.      |
| collection.name              | string | None   | Y        | The name of the collection.                           |
| cumulus_meta                 | object | None   | N        | Internal metadata for Cumulus execution tracking.     |
| cumulus_meta.state_machine   | string | None   | N        | The name of the specific state machine being invoked. |
| cumulus_meta.execution_name  | string | None   | N        | The specific identifier for the current execution.    | 

##### Example of config input:

```json
{
  "provider": {
    "id": "PROV_123",
    "protocol": "s3",
    "host": "my-data-bucket"
  },
  "collection": {
    "name": "landsat_8_records"
  },
  "cumulus_meta": {
    "state_machine": "IngestWorkflow",
    "execution_name": "exec-001-alpha"
  }
}
```
        

Example of workflow configuraton:

```angular2html
            "GranuleToCNM": {
                "Parameters": {
                    "cma": {
                        "event.$": "$",
                        "task_config": {
                            "provider": "{$.meta.provider}",
                            "provider_path": "{$.meta.collection.meta.provider_path}",
                            "collection": "{$.meta.collection}",
                            "cumulus_meta": "{$.cumulus_meta}",
                            "cumulus_message": ""
                        },
                        "ReplaceConfig": {
                            "MaxSize": 10000,
                            "Path": "$",
                            "TargetPath": "$"
                        }
                    }
                },
                "Type": "Task",
                "Resource": "${aws_lambda_function.cumulus_granule_to_cnm_task.arn}",
                "Retry": [
                    {
                        "ErrorEquals": [
                            "Lambda.ServiceException",
                            "Lambda.AWSLambdaException",
                            "Lambda.SdkClientException"
                        ],
                        "IntervalSeconds": 3,
                        "MaxAttempts": 1,
                        "BackoffRate": 3
                    }
                ],
                "Catch": [
                    {
                        "ErrorEquals": [
                            "States.ALL"
                        ],
                        "ResultPath": "$.exception",
                        "Next": "WorkflowFailed"
                    }
                ],
                "Next": "QueueCNMs"
            },
```
The Step Function task definition utilizes a task_config object to manage dynamic inputs. 
As example, within this configuration, the collection field is mapped using JSONPath to the metadata:

    Config Input: "collection": "{$.meta.collection}"


This task is designed as a modular component. You can load it into your infrastructure using the following Terraform example:
```angular2html

module "cma_to_cnm_module" {

   source = "http://github.com/downloadpath/cma_to_cnm_module.zip"
   prefix = var.prefix
   region = var.region
   lambda_role = module.cumulus.lambda_processing_role_arn
   security_group_ids = [aws_security_group.no_ingress_all_egress.id]

    subnet_ids  = var.subnet_ids
    memory_size = 128
    timeout     = 180
    tags        = merge(local.tags, { Project = var.prefix })
 }

 resource "aws_cloudwatch_log_group" "cma_to_cnm_task" {
    name              = "/aws/lambda/${module.cnm_to_cma_module.cnm_to_cma_name}"
    retention_in_days  = var.task_logs_retention_in_days
    
 }
```

### Input


Input array specification:

| field name | type   | default | description
| ---------- |--------| ------- | -----------
| N/A | object | (required) | cnm message

the lambda's event.get('input') is the cnm message.

### Output

Output object fields:

| field name | type            | default | description|
|------------|-----------------| ------- | -----------|
| cnm        | array\<object\> | N/A | cma payload with list of cma files|
| cnm        | object          | N/A | the original cnm message.|


Data Mapping and Payload Configuration

When configuring the task, please refer to the example provided in the "Config" section. Ensure the output is mapped according to the following structure:

    Granule Mapping: The output_granules field must be mapped directly to the primary payload.

    Metadata Attachment: The original Cloud Notification Mechanism (CNM) message should be nested under the meta object.
### Example workflow configuration and use
The output key : cnm_list should be mapped to the payload key in the workflow's output.
Workflow developer could choose to the original cnm message to be stored in meta.cnm key.
Example workflow:
```angular2html
"GranuleToCNM": {
                "Parameters": {
                    "cma": {
                        "event.$": "$",
                        "task_config": {
                            "provider": "{$.meta.provider}",
                            "provider_path": "{$.meta.collection.meta.provider_path}",
                            "collection": "{$.meta.collection}",
                            "cumulus_meta": "{$.cumulus_meta}",
                            "cumulus_message": ""
                        },
                        "ReplaceConfig": {
                            "MaxSize": 10000,
                            "Path": "$",
                            "TargetPath": "$"
                        }
                    }
                },
                "Type": "Task",
                "Resource": "${aws_lambda_function.cumulus_granule_to_cnm_task.arn}",
                "Retry": [
                    {
                        "ErrorEquals": [
                            "Lambda.ServiceException",
                            "Lambda.AWSLambdaException",
                            "Lambda.SdkClientException"
                        ],
                        "IntervalSeconds": 3,
                        "MaxAttempts": 1,
                        "BackoffRate": 3
                    }
                ],
                "Catch": [
                    {
                        "ErrorEquals": [
                            "States.ALL"
                        ],
                        "ResultPath": "$.exception",
                        "Next": "WorkflowFailed"
                    }
                ],
                "Next": "QueueCNMs"
            },
```
## Architecture
```mermaid
architecture-cma-to-cnm
    group trigger(cloud) [Starting Task]
    translate task(cloud)[Task]

    lambda:R --> L:db
```

## Internal Dependencies
Python cumulus-message-adapter library

### External Dependencies
None

## Development and Deployment
#### Developer Notes

- About json schema compiling to Plaint Python classes:
   - used datamodel-code-generator tool: https://koxudaxi.github.io/datamodel-code-generator/ to generate pydantic models from json schema files.
   - example below
```angular2html
pip install datamodel-code-generator
# Or with HTTP support for remote references
pip install "datamodel-code-generator[http]"

datamodel-codegen \
    --input input.json \
    --input-file-type jsonschema \
    --output models_cma.py \
    --output-model-type pydantic_v2.BaseModel
```

## Contributing

To make a contribution, please [see our Cumulus contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md) and our documentation on [adding a task](https://nasa.github.io/cumulus/docs/adding-a-task)


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
