# @cumulus/get-cnm

This task retrieves the originating Cloud Notification Message (CNM) for each input granule.
It does this by querying Cumulus executions for the incoming granules, selecting the oldest
execution per granule, and returning that execution's `originalPayload` as the CNM message.

If the oldest execution has a `parentArn`, the task retrieves the parent execution and returns
the parent execution's `originalPayload` instead.

This task uses the Cumulus Message Adapter and is intended for use in a Cumulus workflow.

## Usage

This lambda takes the following input and config objects, derived from workflow
configuration using the
[Cumulus Message Adapter](https://github.com/nasa/cumulus-message-adapter/blob/master/CONTRACT.md)
to drive configuration from the full cumulus message. The output from the task follows the
Cumulus Message Adapter contract and provides the information detailed below.

### Configuration

This task does not require any task configuration.

| field name | type | default | required | values | description |
| ---------- | ---- | ------- | -------- | ------ | ----------- |
| N/A | N/A | N/A | no | N/A | No configurable fields are used by this task |

### Input

| field name | type | default | required | values | description |
| ---------- | ---- | ------- | -------- | ------ | ----------- |
| granules | array | N/A | yes | N/A | Array of granules to resolve back to originating CNM |
| granules[].granuleId | string | N/A | yes | N/A | Cumulus granule identifier |
| granules[].collectionId | string | N/A | yes | N/A | Collection ID in Cumulus format (for example: `ATL12___007`) |

The following is an example of task input:

```json
{
	"granules": [
		{
			"granuleId": "ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W",
			"collectionId": "ATL12___007"
		},
		{
			"granuleId": "ATL12_20181014155468_02450101_007_02.h5_-C-mRK2W",
			"collectionId": "ATL12___007"
		}
	]
}
```

### Output

The output is an object keyed by input `granuleId`. Each value is the originating
CNM message associated with that granule.

The task validates that `product.name` in each resolved CNM contains the input
`granuleId` value. If no execution is found for a granule, or the CNM `product.name`
does not match, the task raises an error.

The following is an example of task output:

```json
{
	"ATL12_20181014154641_02450101_007_02.h5_-C-mRK2W": {
		"product": {
			"name": "ATL12_20181014154641_02450101_007_02.h5"
		},
		"provider": "podaac",
		"version": "1.0"
	},
	"ATL12_20181014155468_02450101_007_02.h5_-C-mRK2W": {
		"product": {
			"name": "ATL12_20181014155468_02450101_007_02.h5"
		},
		"provider": "podaac",
		"version": "1.0"
	}
}
```
