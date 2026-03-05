# @cumulus/add-input-granules

This task adds a list of granules processed by child ingest executions to its output message. It uses the [Cumulus Python API](https://github.com/nasa/Cumulus-API-Python) to fetch granule information.

## Usage
This task is intended to be used as part of PDR workflows. It is run after all ingest workflows are completed and prior to granule cleanup tasks to which it provides input granules.

### Input

| field name | type | default | required | values | description
| ---------- | ---- | ------- | -------- | ------ | -----------
| pdr | object | N/A | yes | N/A | Product Delivery Record
| pdr.name | string | N/A | yes | N/A | PDR filename
| pdr.path | string | N/A | yes | N/A | PDR location
| pdr.archivePath | string | N/A | no | N/A | Archived PDR location
| running | array[string] | N/A | yes | N/A | List of queued and running workflow execution ARNS
| completed | array[string]  | N/A | yes | N/A | List of completed workflow execution ARNs
| failed | array[object] | N/A | yes | N/A | List of failed workflow ARNs and reason for failure
| failed[].arn | string | N/A | yes | N/A | Failed execution ARN
| failed[].reason | string | N/A | yes | N/A | Reason for workflow failure

### Output

| field name | type | default | required | values | description
| ---------- | ---- | ------- | -------- | ------ | -----------
| pdr | object | N/A | yes | N/A | Product Delivery Record
| pdr.name | string | N/A | yes | N/A | PDR filename
| pdr.path | string | N/A | yes | N/A | PDR location
| pdr.archivePath | string | N/A | yes | N/A | Archived PDR location
| running | array[string] | N/A | yes | N/A | List of queued and running workflow execution ARNS
| completed | array[string]  | N/A | yes | N/A | List of completed workflow execution ARNs
| failed | array[object] | N/A | yes | N/A | List of failed workflow ARNs and reason for failure
| failed[].arn | string | N/A | yes | N/A | Failed execution ARN
| failed[].reason | string | N/A | yes | N/A | Reason for workflow failure
| granules | array[object] | N/A | yes | N/A | List of granules
| granules[].granuleId | string | N/A | yes | N/A | Granule ID
| granules[].files | array[object] | N/A | yes | N/A | List of files associated with granule
| granules[].files[].bucket | string | N/A | yes | N/A | Bucket where file is archived in S3
| granules[].files[].checksum | string | N/A | no | N/A | Checksum value for file
| granules[].files[].fileName | string | N/A | no | N/A | Name of file (e.g. file.txt)
| granules[].files[].key | string | N/A | yes | N/A | S3 Key for archived file
| granules[].files[].size | integer | N/A | no | N/A | Size of file (in bytes)
| granules[].files[].source | string | N/A | no | N/A | Source URI of the file from origin system (e.g. S3, FTP, HTTP)
| granules[].files[].type | string | N/A | no | N/A | Type of file (e.g. data, metadata, browse)

### Example workflow configuration and use


### Internal Dependencies

This task uses the Cumulus Private API Lambda via the Cumulus Python API and requires the `PRIVATE_API_LAMBDA_ARN` environment variable to be set.

### External Dependencies

 - https://github.com/nasa/Cumulus-API-Python
 - https://github.com/nasa/cumulus-message-adapter
 - https://github.com/nasa/cumulus-message-adapter-python

## Contributing

To make a contribution, please [see our Cumulus contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md) and our documentation on [adding a task](https://nasa.github.io/cumulus/docs/adding-a-task)

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)
