# @cumulus/files-to-granules

This lambda function converts array-of-files input payloads into granule object output payloads.
It is primarily intended to support compatibility with the standard output of a [cumulus-process](https://github.com/nasa/cumulus-process-py) task,
and convert that output into a granule object accepted as input by the majority of other Cumulus tasks.

## Message configuration

For more information on configuring a Cumulus Message Adapter task, see [the Cumulus workflow input/output documentation](https://nasa.github.io/cumulus/docs/workflows/input_output).

### Config

Config object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| inputGranules | array\<object\> | (required) | Granules to which the files belong
| granuleIdExtraction | string | (.*) | Regex used to extract granuleId from filenames

### Input

Input array specification:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| N/A | array\<string\> | (required) | Array of S3 URIs (i.e. `s3://bucket/path/to/file`);

### Output

Output object fields:

| field name | type | default | description
| ---------- | ---- | ------- | -----------
| granules | array\<object\> | N/A | Array of inputGranules merged with S3 files input

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
