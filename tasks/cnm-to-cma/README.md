# @cumulus/files-to-granules

This lambda function converts Cloud Notification Mechanism format to CMA message
format.

CNM schema is defined in schemas/cumulus_sns_schema.json
payload file schema defined in schema/files.schea.json
## Message configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name          | type   | default    | description
|---------------------|--------|------------| -----------
| collection          | object | (optional) | collection.granuleIdExtraction:Regex used to extract granuleId from filenames


```angular2html
"TranslateMessage": {
        "Parameters": {
          "cma": {
            "event.$": "$",
            "task_config": {
              "collection": "{$.meta.collection}",
              "cumulus_message": {
                "outputs": [
                  {
                    "source": "{$.cnm}",
                    "destination": "{$.meta.cnm}"
                  },
                  {
                    "source": "{$.output_granules}",
                    "destination": "{$.payload}"
                  }
                ]
              }
            }
          }
        },
        "Type": "Task",
        "Resource": "${module.cnm_to_cma_module.cnm_to_cma_arn}",
        "Retry": [
          {
            "ErrorEquals": [
              "States.ALL"
            ],
            "IntervalSeconds": 10,
            "MaxAttempts": 2
          }
        ],
        "Catch": [
          {
            "ErrorEquals": [
              "States.ALL"
            ],
            "ResultPath": "$.exception",
            "Next": "CnmResponseFailChoice"
          }
        ],
        "Next": "Report"
      },
```
The Step Function task definition utilizes a task_config object to manage dynamic inputs. Within this configuration, the collection field is mapped using JSONPath to the metadata:

    Config Input: "collection": "{$.meta.collection}"

Granule ID Extraction

Users can define a regular expression via collection.granuleIdExtraction. This regex is applied to the product.name field within the Cloud Notification Mechanism (CNM) to accurately extract the unique granuleId.
Terraform Implementation

This task is designed as a modular component. You can load it into your infrastructure using the following Terraform example:
```angular2html

module "cnm_to_cma_module" {

   source = "http://github.com/downloadpath/cnm2cma_module.zip"
   prefix = var.prefix
   region = var.region
   lambda_role = module.cumulus.lambda_processing_role_arn
   security_group_ids = [aws_security_group.no_ingress_all_egress.id]

    subnet_ids = var.subnet_ids
    memory_size = 128
    timeout = 180
 }

 resource "aws_cloudwatch_log_group" "cnm_to_cma_task" {
    name              = "/aws/lambda/${module.cnm_to_cma_module.cnm_to_cma_name}"
   retention_in_days = var.task_logs_retention_in_days
   tags              = merge(local.tags, { Project = var.prefix })
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

| field name | type            | default | description
|------------|-----------------| ------- | -----------
| granules   | array\<object\> | N/A | cma payload with list of cma files
| cnm        | object          | N/A | the original cnm message.


Data Mapping and Payload Configuration

When configuring the task, please refer to the example provided in the "Config" section. Ensure the output is mapped according to the following structure:

    Granule Mapping: The output_granules field must be mapped directly to the primary payload.

    Metadata Attachment: The original Cloud Notification Mechanism (CNM) message should be nested under the meta object.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
