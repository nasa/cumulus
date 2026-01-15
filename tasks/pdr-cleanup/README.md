# @cumulus/pdr-cleanup

Lambda function handler for cleaning up PDRs and moving them to an archive directory. PDRs are moved to a `PDRs` directory under the provider host. This task only supports archiving PDRs with an S3 Cumulus provider.

## Usage

This lambda takes the following input and config objects, derived from workflow configuration using the [Cumulus Message Adapter](https://github.com/nasa/cumulus-message-adapter/blob/master/CONTRACT.md) to drive configuration from the full cumulus message. The output from the task follows the Cumulus Message Adapter contract and provides the information detailed below.

### Configuration

| field name | type | default | required | values | description
| ---------- | ---- | ------- | -------- | ------ | -----------
| provider | object | N/A | yes | N/A | A provider object used to move a PDR and determine its archive location
| provider.protocol | string | N/A | yes | `http`, `https`, `ftp`, `sftp`, `s3` | The Cumulus provider protocol (task only supports s3)
| provider.host | string | N/A | yes | N/A | The Cumulus provider host

### Input

| field name | type | default | required | values | description
| ---------- | ---- | ------- | -------- | ------ | -----------
| pdr | object | N/A | yes | N/A | Product Delivery Record
| pdr.name | string | N/A | yes | N/A | Filename of the PDR
| pdr.path | string | N/A | yes | N/A | Location of the PDR
| running | array[string] | N/A | no | N/A | List of execution arns which are queued or running
| completed | array[string]  | N/A | no | N/A | List of completed execution arns
| failed | arry[object] | N/A | yes | N/A | List of failed execution arns with reason
| failed[].arn | string | N/A | yes | N/A | AWS failed ARN
| failed[].reason | string | N/A | no | N/A | Reason for workflow failure

### Output

This task outputs the archive path of the cleaned up PDR

### Example workflow configuration and use
```json
"CleanupPDR": {
    "Type": "Task",
    "Parameters": {
        "cma": {
        "event.$": "$",
        "task_config": {
            "provider": "{$.meta.provider}"
        }
        }
    },
    "Resource": "${cleanup_pdr_task_arn}",
    "Next": "AddInputGranules",
    "Catch": [
        {
        "ErrorEquals": [
            "States.ALL"
        ],
        "Next": "WorkflowFailed",
        "ResultPath": "$.exception"
        }
    ],
    "Retry": [
        {
        "BackoffRate": 2,
        "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.TooManyRequestsException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
        ],
        "IntervalSeconds": 5,
        "MaxAttempts": 10
        }
    ]
},
```

### Internal Dependencies

This task relies on AWS S3 and the Cumulus Message Adapter

### External Dependencies

N/A

## Contributing

To make a contribution, please [see our Cumulus contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md) and our documentation on [adding a task](https://nasa.github.io/cumulus/docs/adding-a-task)

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)