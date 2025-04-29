# @cumulus/add-unique-granuleID

This is a [Cumulus](https://nasa.github.io/cumulus) task which takes the following actions on each granule in an incoming set of payload granules:

- Adds the existing `granuleId` to the `producerGranuleId` key
- Updates the existing `granuleId` field to a 'unique' value based on the algorithim used in @cumulus/ingest `generateUniqueGranuleId`

## Usage

This lambda takes the following input and config objects, derived from workflow configuration using the [Cumulus Message Adapter](https://github.com/nasa/cumulus-message-adapter/blob/master/CONTRACT.md) to drive configuration from the full cumulus message:

### Input

The input takes a list of Cumulus `API` formatted granules, with the following required fields:

```json
{
  "granules": [
    {
      "granuleId": "foobar",
      "collectionId": "someCollection___001"
      ...
    }
  ]
}
```

### Config Object

The config object has one key that allows specification of the truncated size of the MD5 hash used to uniquify the granuleID.

```json
{
  "hashDepth": 8
}
```

### Output

Output is a list of Cumulus API granules

```JSON
{
  granules: []
}
```

### Example workflow configuration block

```json
"AddUniqueGranuleId": {
      "Parameters": {
        "cma": {
          "event.$": "$",
          "ReplaceConfig": {
            "Path": "$.payload",
            "TargetPath": "$.payload"

          },
          "task_config": {
            "hashDepth": "6",
          }
        }
      },
      "Type": "Task",
      "Resource": "${add_unique_granule_id_arn}",
      "Retry": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "IntervalSeconds": 5,
          "MaxAttempts": 3
        }
      ],
      "Next": "SomeOtherLambda"
    }
```

### Example of working payload

For a current example of the raw values needed to run this lambda in the CMA context, please see the [related Cumulus integration test](https://github.com/nasa/cumulus/example/spec/parallel/addUniqueGranuleId/AddUniqueGranuleIdSpec.js#L35).

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
