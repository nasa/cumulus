---
id: browse-generation
title: Ingest Browse Generation
hide_title: true
---

# Browse Generation

This entry documents how to setup a workflow that utilizes Cumulus's built-in granule file fileType configuration such that on ingest the browse data is exported to CMR.

We will discuss how to run a processing workflow against an inbound granule that has data but no browse generated.  The workflow will generate a browse file and add the appropriate output values to the Cumulus message so that the built-in post-to-cmr task will publish the data appropriately.

## Sections:

* [Prerequisites](#prerequisites)
* [Configure Cumulus](#configure-cumulus)
* [Configure Ingest](#configure-ingest)
* [Run Workflows](#run-workflows)
* [Build Processing Lambda](#build-processing-lambda)


## Prerequisites

### Cumulus

This entry assumes you have a deployed instance of Cumulus (> version 1.11.3), and a working dashboard following the instructions in the [deployment documentation](../deployment/deployment-readme).  This entry also assumes you have some knowledge of how to configure Collections, Providers and Rules and basic Cumulus operation.

Prior to working through this entry, you should be somewhat familiar with the [Hello World](hello-world) example the [Workflows](../workflows/workflows-readme) section of the documentation, and [building Cumulus lambdas](../workflows/lambda).

You should also review the [Data Cookbooks Setup](setup) portion of the documentation as it contains useful information on the inter-task message schema expectations.

This entry will utilize the [dashboard application](https://github.com/nasa/cumulus-dashboard).  You will need to have a dashboard deployed as described in the [Cumulus deployment documentation](../deployment/deployment-readme) to follow the instructions in this example.

If you'd prefer to *not* utilize a running dashboard to add Collections, Providers and trigger Rules, you can set the Collection/Provider and Rule via the API, however in that instance you should be very familiar with the [Cumulus API](https://nasa.github.io/cumulus-api/) before attempting the example in this entry.

### Common Metadata Repository

You should be familiar with the [Common Metadata Repository](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/common-metadata-repository) and already be set up as a provider with configured collections and credentials to ingest data into CMR.   You should know what the collection name and version number are.

### Source Data

You should have data available for Cumulus to ingest in an S3 bucket that matches with CMR if you'd like to push a record to CMR UAT.

For the purposes of this entry, we will be using a pre-configured  MOD09GQ version 006 CMR collection.    If you'd prefer to utilize the example processing code, using mocked up data files matching the file naming convention will suffice, so long as you also have a matching collection setup in CMR.

If you'd prefer to ingest another data type, you will need to generate a processing lambda (see [Build Processing Lambda](#build-processing-lamvda) below).

-----------

## Configure Cumulus

### CMR

Visit the [config_description](../deployment/config_descriptions#cmr) documentation for instructions on CMR integration and configuration.

These configuration keys will be used in the CmrStep/PostToCmr Lambda function below.

### Workflows

#### Summary

For this example, you are going to be adding two workflows to your Cumulus deployment configuration.

* DiscoverGranulesBrowseExample

  This workflow will run the ```DiscoverGranules``` task, targeting the S3 bucket/folder mentioned in the prerequisites.    The output of that task will be passed into QueueGranules, which will trigger the second workflow for each granule to be ingested.   The example presented here will be a single granule with a .hdf data file and a .met metadata file only, however your setup may result in more granules, or different files.


* CookbookBrowseExample

  This workflow will be triggered for each granule in the previous workflow.    It will utilize the SyncGranule task, which brings the files into a staging location in the Cumulus buckets.

  The output from this task will be passed into the ```ProcessingStep``` step , which in this example will utilize the ```FakeProcessingLambda``` task we provide for testing/as an example in Core, however to use your own data you will need to write a lambda that generates the appropriate CMR metadata file and accepts and returns appropriate task inputs and outputs.

  From that task  we will utilize a core task ```FilesToGranules``` that will transform the processing output event.input list/config.InputGranules into an array of Cumulus [granules](https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js) objects.

  Using the generated granules list, we will utilize the core task ```MoveGranules``` to move the granules to the target buckets as defined in the collection configuration.  That task will transfer the files to their final storage location and update the CMR metadata files and the granules list as output.

  That output will be used in the ```PostToCmr``` task combined with the previously generated CMR file to export the granule metadata to CMR.

#### Workflow Configuration

Add the following to a new file ```browseExample.yml``` in your deployment's main directory (the same location your app directory, lambdas.yml, etc are), copy the example file [from github](https://github.com/nasa/cumulus/blob/master/example/workflows/browseExample.yml).  The file should contain the two example workflows.

A few things to note about tasks in the workflow being added:

*  The CMR step in CookbookBrowseExample:

```
 CmrStep:
      CumulusConfig:
        bucket: '{$.meta.buckets.internal.name}'
        stack: '{$.meta.stack}'
        cmr: '{$.meta.cmr}'
        process: '{$.cumulus_meta.process}'
        input_granules: '{$.meta.input_granules}'
        granuleIdExtraction: '{$.meta.collection.granuleIdExtraction}'
      Type: Task
      Resource: ${PostToCmrLambdaFunction.Arn}
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: StopStatus
      Next: StopStatus
```

Note that in the task, the event.config.cmr will contain the values you configured in the ```cmr``` configuration section above.

* The Processing step in CookbookBrowseExample:

```
    ProcessingStep:
      CumulusConfig:
        bucket: '{$.meta.buckets.internal.name}'
        collection: '{$.meta.collection}'
        cmrMetadataFormat: '{$.meta.cmrMetadataFormat}'
        additionalUrls: '{$.meta.additionalUrls}'
        generateFakeBrowse: true
      Type: Task
      Resource: ${FakeProcessingLambdaFunction.Arn}
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: StopStatus
      Retry:
        - ErrorEquals:
            - States.ALL
          IntervalSeconds: 2
          MaxAttempts: 3
      Next: FilesToGranulesStep
```

**Please note**: ```FakeProcessing``` is the core provided browse/cmr generation we're using for the example in this entry.

 If you're not ingesting mock data matching the example, or would like to use modify the example to ingest your own data please see the [build-lambda](#build-lambda) section below.    You will need to configure a different lambda entry for your lambda and utilize it in place of the ```Resource``` defined in the example workflow.

#### Cumulus Configuration

In an editor, open app/config.yml and modify your stepFunctions key to contain the file you just created:

```
stepFunctions: !!files [
  {some list of workflows},
  'browseExample.yml'
]
```

This will cause kes to export the workflows in the new file along with the other workflows configured for your deployment.


#### Lambdas

Ensure the following lambdas are in your deployment's lambdas.yml (reference the [example lambdas.yml](https://github.com/nasa/cumulus/blob/master/example/lambdas.yml)):

```
DiscoverGranulesNoVpc:
  handler: index.handler
  timeout: 300
  memory: 512
  source: node_modules/@cumulus/discover-granules/dist/
  useMessageAdapter: true
QueueGranules:
  handler: index.handler
  timeout: 300
  source: node_modules/@cumulus/queue-granules/dist/
  useMessageAdapter: true
SyncGranuleNoVpc:
  handler: index.handler
  timeout: 300
  logToElasticSearch: true
  source: node_modules/@cumulus/sync-granule/dist/
  useMessageAdapter: true
FilesToGranules:
  handler: index.handler
  source: node_modules/@cumulus/files-to-granules/dist/
FakeProcessing:
  handler: index.handler
  source: node_modules/@cumulus/test-processing/dist/
  useMessageAdapter: true
MoveGranules:
  handler: index.handler
  timeout: 300
  source: node_modules/@cumulus/move-granules/dist/
PostToCmr:
  handler: index.handler
  timeout: 300
  memory: 256
  logToElasticSearch: true
  source: node_modules/@cumulus/post-to-cmr/dist/
  useMessageAdapter: true
  envs:
    system_bucket: '{{system_bucket}}'
```

**Please note**: ```FakeProcessing``` is the core provided browse/cmr generation we're using for the example.

 If you're not ingesting mock data matching the example, or would like to use this entry to ingest your own data please see the [build-lambda](#build-lambda) section below.    You will need to configure a different lambda entry for your lambda and utilize it in place of the ```Resource``` defined in the example workflow.


#### Redeploy

Once you've configured your CMR credentials, updated your workflow configuration, and updated your lambda configuration you should be able to redeploy your cumulus instance:

```./node_modules/.bin/kes cf deploy --kes-folder app --region <region> --template node_modules/@cumulus/deployment/app --deployment <deployment>```

You should expect to see a successful deployment message similar to:

```
Template saved to app/cloudformation.yml
Uploaded: s3://<bucket and key>/cloudformation.yml
Waiting for the CF operation to complete
CF operation is in state of UPDATE_COMPLETE

Here are the important URLs for this deployment:

Distribution:  https://example.com/
Add this url to URS:  https://example.com/redirect

Api:  XXXXXXX
Add this url to URS:  XXXXXXXXXX
Uploading Cumulus Message Templates for each Workflow ...
......
restarting ECS task XXXXXXXXXX
ECS task aXXXXXXXX restarted
api endpoints with the id XXXXXXXXXXX redeployed.
Redeploying XXXXXXXXXX was throttled. Another attempt will be made in 20 seconds
distribution endpoints with the id XXXXXXXXXX redeployed.
```

Wait for the above to complete. It's particularly important that the new workflow message template is uploaded for the workflow to complete.

-----------

## Configure Ingest

Now that the Cumulus stacks for your deployment have been updated with the new workflows and code, we will use the Cumulus dashboard to configure an ingest collection, provider and rule so that we can trigger the configured workflow.

### Add Collection

Navigate to the 'Collection' tab on the interface and add a collection.  Note that you need to set the "provider_path" to the path on your bucket (e.g. "/data") that you've staged your mock/test data.

```
{
	"name": "MOD09GQ",
	"version": "006",
	"dataType": "MOD09GQ",
	"process": "modis",
	"provider_path": "{{path_to_data}}",
	"url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{substring(file.name, 0, 3)}",
	"duplicateHandling": "replace",
	"granuleId": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}$",
	"granuleIdExtraction": "(MOD09GQ\\..*)(\\.hdf|\\.cmr|_ndvi\\.jpg|\\.jpg)",
	"sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
	"files": [
		{
			"bucket": "protected",
			"regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.hdf$",
			"sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
			"fileType": "data",
			"url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/{substring(file.name, 0, 3)}"
		},
		{
			"bucket": "private",
			"regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.hdf\\.met$",
			"sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf.met",
			"fileType": "metadata"
		},
		{
			"bucket": "protected-2",
			"regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.cmr\\.xml$",
			"sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.cmr.xml"
		},
		{
			"bucket": "protected",
			"regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.jpg$",
			"sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.jpg"
		}
	],
}
```

**Please note**: Even though our initial discover granules ingest brings in only the .hdf and .met files we've staged, we still configure the other possible file types for this collection's granules.

### Add Provider

Next navigate to the Provider tab and create a provider with the following values, using whatever name you wish, and the bucket the data was staged to as the host:

```
Name:
Protocol: S3
Host: {{data_source_bucket}}
```

### Add Rule

Once you have your provider and rule added, go to the Rules tab, and add a rule with the following values (using whatever name you wish, populating the workflow and provider keys with the previously entered values:

```
{
	"name": "TestBrowseGeneration",
	"workflow": "DiscoverGranulesBrowseExample",
	"provider": {{provider_from_previous_step}},
	"collection": {
		"name": "MOD09GQ",
		"version": "006"
	},
	"meta": {},
	"rule": {
		"type": "onetime"
	},
	"state": "ENABLED",
	"updatedAt": 1553053438767
}
```

-----------

## Run Workflows

Once you've configured the Collection and Provider and added a onetime rule, you're ready to trigger your rule, and watch the ingest workflows process.

Go to the Rules tab, click the rule you just created:

![Image Missing](../../assets/browse_processing_1.png)

Then click the gear in the upper right corner and click "ReRun":

![Image Missing](../../assets/browse_processing_2.png)

Tab over to executions and you should see the ```DiscoverGranulesBrowseExample``` workflow fire, succeed and then moments later the ```CookbookBrowseExample```.

![Image Missing](../../assets/browse_processing_3.png)

### Results

You can verify your data has ingested by clicking the successful workflow entry:

![Image Missing](../../assets/browse_processing_4.png)

Select "Show Output" on the next page

![Image Missing](../../assets/browse_processing_5.png)

and you should see in the payload from the workflow something similar to:

```
"payload": {
    "process": "modis",
    "granules": [
      {
        "files": [
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "filepath": "MOD09GQ___006/2017/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "fileType": "data",
            "bucket": "cumulus-test-sandbox-protected",
            "filename": "s3://cumulus-test-sandbox-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "time": 1553027415000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/{substring(file.name, 0, 3)}",
            "duplicate_found": true,
            "size": 1908635
          },
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
            "filepath": "MOD09GQ___006/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
            "fileType": "metadata",
            "bucket": "cumulus-test-sandbox-private",
            "filename": "s3://cumulus-test-sandbox-private/MOD09GQ___006/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
            "time": 1553027412000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{substring(file.name, 0, 3)}",
            "duplicate_found": true,
            "size": 21708
          },
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.jpg",
            "filepath": "MOD09GQ___006/2017/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.jpg",
            "fileType": "browse",
            "bucket": "cumulus-test-sandbox-protected",
            "filename": "s3://cumulus-test-sandbox-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.jpg",
            "time": 1553027415000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/{substring(file.name, 0, 3)}",
            "duplicate_found": true,
            "size": 1908635
          },
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml",
            "filepath": "MOD09GQ___006/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml",
            "fileType": "metadata",
            "bucket": "cumulus-test-sandbox-protected-2",
            "filename": "s3://cumulus-test-sandbox-protected-2/MOD09GQ___006/MOD/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{substring(file.name, 0, 3)}"
          }
        ],
        "cmrLink": "https://cmr.uat.earthdata.nasa.gov/search/granules.json?concept_id=G1222231611-CUMULUS",
        "cmrConceptId": "G1222231611-CUMULUS",
        "granuleId": "MOD09GQ.A2016358.h13v04.006.2016360104606",
        "cmrMetadataFormat": "echo10",
        "dataType": "MOD09GQ",
        "version": "006",
        "published": true
      }
    ]
```

You can verify the granules exist within your cumulus instance (search using the Granules interface, check the S3 buckets, etc) and validate that the above CMR entry


-----


## Build Processing Lambda

This section discusses the construction of a custom processing lambda to replace the contrived example from this entry for a real dataset processing task.

To ingest your own data using this example, you will need to construct your own lambda to replace the source in ProcessingStep that will generate browse imagery and provide or update a CMR metadata export file.

The discussion below outlines requirements for this lambda.

### Inputs

The incoming message to the task defined in the  ```ProcessingStep``` as configured will have the following configuration values (accessible inside event.config courtesy of the message adapter):

#### Configuration

* event.config.bucket -- the bucket configured in config.yml as your 'internal' bucket.

* event.config.collection -- The full collection object we will configure in the (Configure Ingest)[#configure-ingest] section.   You can view the expected collection schema in the docs (here)[/data-cookbooks/setup] or in the source code (on github)[https://github.com/nasa/cumulus/blob/master/packages/api/models/schemas.js]  You need this as available input *and* output so you can update as needed.

```event.config.additionalUrls```, ```generateFakeBrowse```  and ```event.config.cmrMetadataFormat``` from the example can be ignored as they're configuration flags for the provided example script.

#### Payload

The 'payload' from the previous task is accessible via event.input.    The expected payload output schema from SyncGranules can be viewed [here](https://github.com/nasa/cumulus/blob/master/tasks/move-granules/schemas/output.json).

In our example, the payload would look like the following.  **Note**: The fileTypes are set per-file based on what we configured in our collection, and were initially added as part of the ```DiscoverGranules``` step in the ```DiscoverGranulesBrowseExample``` workflow.

```
 "payload": {
    "process": "modis",
    "granules": [
      {
        "granuleId": "MOD09GQ.A2016358.h13v04.006.2016360104606",
        "dataType": "MOD09GQ",
        "version": "006",
        "files": [
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "fileType": "data",
            "bucket": "cumulus-test-sandbox-internal",
            "filename": "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "fileStagingDir": "file-staging/jk2/MOD09GQ___006",
            "time": 1553027415000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/{substring(file.name, 0, 3)}",
            "size": 1908635
          },
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
            "fileType": "metadata",
            "bucket": "cumulus-test-sandbox-internal",
            "filename": "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
            "fileStagingDir": "file-staging/jk2/MOD09GQ___006",
            "time": 1553027412000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{substring(file.name, 0, 3)}",
            "size": 21708
          }
        ]
      }
    ]
  }
```

### Generating Browse Imagery

The provided example script used in the example goes through all granules and adds a 'fake' .jpg browse file to the same staging location as the data staged by prior ingest tasksf.

The processing lambda you construct will need to do the following:

* Create a browse image file based on the input data, and stage it to a location accessible to both this task and the ```FilesToGranules``` and ```MoveGranules``` tasks in a S3 bucket.
* Add the browse file to the input granule files, making sure to set the granule fileType to ```browse```.
* Update meta.input_granules with the updated granules list, as well as provide the files to be integrated by ```FilesToGranules``` as output from the task.


### Generating/updating CMR metadata

If you do not already have a CMR file in the granules list, you will need to generate one for valid export.   This example's processing script generates and adds it to the ```FilesToGranules``` file list via the payload  but it can be present in the InputGranules from the DiscoverGranules task as well if you'd prefer to pre-generate it.

Both downstream tasks ```MoveGranules``` and ```PostToCmr``` expect a valid CMR file to be available if you want to export to CMR.

### Expected Outputs for processing task/tasks

In the above example, the critical portion of the output to ```FilesToGranules``` is the payload and meta.input_granules.

In the example provided, the processing task is setup to return an object with the keys "files" and "granules".   In the cumulus_message configuration, the outputs are mapped in the configuration to the payload, granules to meta.input_granules:

```
            - source: '{$.granules}'
              destination: '{$.meta.input_granules}'
            - source: '{$.files}'
              destination: '{$.payload}'
```

Their expected values from the example above may be useful in constructing a processing task:

#### payload

The payload includes a full list of files to be 'moved' into the cumulus archive.   The ```FilesToGranules``` task will take this list, merge it with the information from ```InputGranules```, then pass that list to the ```MoveGranules``` task.  The ```MoveGranules``` task will then move the files to their targets and update the CMR metadata file if it exists with the updated granule locations.

In the provided example, a payload being passed to the  ```FilesToGranules``` task should be expected to look like:

```
  "payload": [
    "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
    "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
    "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.jpg",
    "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.cmr.xml"
  ]
```

This list is the list of granules ```FilesToGranules``` will act upon to add/merge with the input_granules object.

The pathing is generated from sync-granules, but in principle the files can be staged wherever you like so long as the processing/```MoveGranules``` task's roles have access and the filename matches the collection configuration.

#### input_granules

The ```FilesToGranules``` task utilizes the incoming payload to chose which files to move, but pulls all other metadata from meta.input_granules.  As such, the output payload in the example would look like:

```
"input_granules": [
      {
        "granuleId": "MOD09GQ.A2016358.h13v04.006.2016360104606",
        "dataType": "MOD09GQ",
        "version": "006",
        "files": [
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "fileType": "data",
            "bucket": "cumulus-test-sandbox-internal",
            "filename": "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf",
            "fileStagingDir": "file-staging/jk2/MOD09GQ___006",
            "time": 1553027415000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/{substring(file.name, 0, 3)}",
            "duplicate_found": true,
            "size": 1908635
          },
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
            "fileType": "metadata",
            "bucket": "cumulus-test-sandbox-internal",
            "filename": "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met",
            "fileStagingDir": "file-staging/jk2/MOD09GQ___006",
            "time": 1553027412000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{substring(file.name, 0, 3)}",
            "duplicate_found": true,
            "size": 21708
          },
          {
            "name": "MOD09GQ.A2016358.h13v04.006.2016360104606.jpg",
            "fileType": "browse",
            "bucket": "cumulus-test-sandbox-internal",
            "filename": "s3://cumulus-test-sandbox-internal/file-staging/jk2/MOD09GQ___006/MOD09GQ.A2016358.h13v04.006.2016360104606.jpg",
            "fileStagingDir": "file-staging/jk2/MOD09GQ___006",
            "time": 1553027415000,
            "path": "data",
            "url_path": "{cmrMetadata.Granule.Collection.ShortName}___{cmrMetadata.Granule.Collection.VersionId}/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/{substring(file.name, 0, 3)}",
            "duplicate_found": true,
          }
        ]
      }
    ],
```

