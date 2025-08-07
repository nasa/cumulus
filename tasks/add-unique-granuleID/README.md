# @cumulus/add-unique-granuleID

This is a [Cumulus](https://nasa.github.io/cumulus) task which takes the following actions on each granule in an incoming set of payload granules:

- Populates `producerGranuleId` key with the value of `granuleId`
- Updates the existing `granuleId` field to a 'unique' value based on the algorithim used in @cumulus/ingest `generateUniqueGranuleId`

**Please Note**: This task is intended only for use in active ingest scenarios, or in workflows where incoming granules do not have a producerGranuleId populated, have a granuleId populated AND it is desirable to 'uniquify' the archival granuleId to be distinct from the producer provided/derived granuleId.

## Usage

This lambda takes the following input and config objects, derived from workflow configuration using the [Cumulus Message Adapter](https://github.com/nasa/cumulus-message-adapter/blob/master/CONTRACT.md) to drive configuration from the full cumulus message:

### Input

The input takes a list of granule objects in one of two formats, with the following required fields:

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

or

```json
{
  "granules": [
    {
      "granuleId": "foobar",
      "datatype": "someCollection",
      "version": "001"
      ...
    }
  ]
}
```

### Config Object

The config object has two keys, `hashLength`, which allows specification of the truncated size of the MD5 hash used to uniquify the `granuleID`, defaulting to 8, and
`includeTimestampHashKey`, which is a boolean that controls whether the hash string includes timestamp in the `generateUniqueGranuleId` function, defaulting to `false`.
- If `false`(default): The hash is based only on `collectionId`. This means:
    - Granules with identical `ids` within the same collection will collide, as their hash will be identical.
    - Granules with identical `ids` across different collections are supported.
- If `true`: The hash includes ``collectionId` and a timestamp, ensuring:
    - All granules are uniquified, even granules with identical `ids` in the same collection.
    - Collision risk is extremely low (less than 0.1%).

```json
{
  "hashLength": 8,
  "includeTimestampHashKey" : false,
}
```

### Output

Output is list of granules in like format as the input *with* field modifications made (and other fields preserved).

```JSON
{
  "granules": [{ "granuleId": "foobar_24asdfh", "producerGranuleId": "foobar", "datatype": "someCollection", "version": "001" }]}
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
            "hashLength": 6,
            "includeTimestampHashKey": true,
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
