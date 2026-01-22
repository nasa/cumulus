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
Example:
     Please refer to the above task definition within Step Functions. Under task_config
"collection": "{$.meta.collection}", is the config input.  user could use
collection.granuleIdExtraction (regex) to extract granuleId from cnm's product.name field.

     This task is intent to be a module to be loaded by terraform script as an example below:

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


Please refer to the task example in "Config" section.  The output area
where 'output_granules' shall be map to the payload and cnm (original cnm)
could be attached under meta.

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
