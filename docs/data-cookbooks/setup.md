# Setup

### Getting setup to work with data-cookboooks

In the following data cookbooks we'll go through things like setting up workflows, making configuration changes, and interacting with CNM. The point of this section is to set up, or at least better understand, collections, providers, and rules and how they are configured.


### Schemas

Looking at our api schema [definitions](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) can provide us with some insight into collections, providers, rules, and their attributes (and whether those are required or not). The schema for different concepts will be reference throughout this document.

**Note:** The schemas are _extremely_ useful for understanding what attributes are configurable and which of those are required. Indeed, they are what the Cumulus code validates definitions (whether that be collection, provider, or others) against. Much of this document is simply providing some context to the information in the schemas.


### Collections

Collections are logical sets of data objects of the same data type and version. We have a few [test collections](https://github.com/nasa/cumulus/tree/master/example/data/collections) configured in Cumulus source for integration testing. Collections can be viewed, edited, added, and removed from the Cumulus dashboard under the "Collections" navigation tab. Additionally, they can be managed via the [collections api](https://nasa.github.io/cumulus-api/?language=Python#list-collections).

The schema for collections can be found [here](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) as the object assigned to `module.exports.collection` and tells us all about what values are expected, accepted, and required in a collection object (where required attribute keys are assigned as a string to the `required` attribute).

**Break down of [s3_MOD09GQ_006.json](https://github.com/nasa/cumulus/tree/master/example/data/collections/s3_MOD09GQ_006.json)**

|Key  |Value|Required  |Description|
|:---:|:-----:|:--------:|---|
|name |`"MOD09GQ"`|Yes|The name attribute designates the name of the collection. This is the name under which the collection will be displayed on the dashboard|
|version|`"006"`|Yes|A version tag for the collection|
|process|`"modis"`|Yes|The options for this are found in "ChooseProcess and in workflows.yml|
|granuleId|`"^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$"`|Yes|REGEX to match granuleId|
|granuleIdExtraction|`"(MOD09GQ\\..*)(\\.hdf\|\\.cmr\|_ndvi\\.jpg)"`|Yes|REGEX that extracts granuleId from file names|
|sampleFileName|`"MOD09GQ.A2017025.h21v00.006.2017034065104.hdf"`|Yes|...|
|files|`<JSON Object>` defined [here](####files)|Yes|Describe the individual files that will exist for each granule in this collection (size, browse, meta, etc.)|
|provider_path|`"cumulus-test-data/pdrs"`|No|This collection is expecting to find data in a `cumulus-test-data/pdrs` directory, whether that be in S3 or at an http endpoint|
|dataType|`"MOD09GQ"`|No|# TODO|
|duplicateHandling|`"replace"`|(replace|version|skip) determines granule duplicate handling scheme|
|url_path|`"{cmrMetadata.Granule.Collection.ShortName}/{substring(file.name, 0, 3)}"`|No|Filename without extension|

#### files
```
"files": [
  {
    "bucket": internal # Which S3 bucket this collection will live in. The available buckets are configured in the Cumulus deployment file: app/config.yml (but should be entered here WITHOUT the stack-name). cumulus-test-internal -> internal (if the stack-name is cumulus-test),
    "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$",
    "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf"
  },
  ...
]
```


### Providers

Providers ingest, archive, process, and distribute satellite data on-demand. They generate input data. Schema for providers can be found [here](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) in the object assigned to `module.exports.provider`. A few example provider configurations can be found [here](https://github.com/nasa/cumulus/tree/master/example/data/providers). Providers can be viewed, edited, added, and removed from the Cumulus dashboard under the "Providers" navigation tab. Additionally, they can be managed via the [providers api](https://nasa.github.io/cumulus-api/?language=Python#list-providers).

**Break down of [s3_provider.json](https://github.com/nasa/cumulus/tree/tree/example/data/providers/s3_provider.json):**

**Required:**
```
"id" = "s3_provider" # unique identifier for provider
"globalConnectionLimit": 10
"protocol": "s3" # (http|https|ftp|sftp|s3)
"host": "cumulus-data-shared" # host where the files will exist
```

**Optional:**
```
"port": # which port to connect to the provider on
"username": # Username for access to the provider. Plain-text or encrypted. Encrypted is highly suggested.
"password": # Password for access to the provider. Plain-text or encrypted. Encrypted is highly suggested.
"encrypted": # Are the username and password credentials encrypted?
"updatedAt": # This will be updated automatically
```
_The above optional attributes are not shown in the example provided, but they have been included in this document for completeness_


### Rules

Rules are used by to start processing workflows and the transformation process. Rules can be invoked manually, based on a schedule, or can be configured to be triggered by events in [Kinesis](./cnm-workflow.md) or SNS. The current best way to understand rules is to take a look at the [schema](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) (specifically the object assigned to `module.exports.rule`). Rules can be viewed, edited, added, and removed from the Cumulus dashboard under the "Rules" navigation tab. Additionally, they can be managed via the [rules api](https://nasa.github.io/cumulus-api/?language=Python#list-rules).

We don't currently have examples of rules in the Cumulus repo, but we can see how to create a rule from the Cumulus dashboard.
1. In the Cumulus dashboard, click `Rules` on the navigation bar.
2. Click the `Add a rule` button.

```
name: Name of the rule. This is the name under which the rule will be displayed in the dashboard.
Workflow Name: name of the workflow you're going to run. A list of available workflows can be found on the Workflows page.
Provider ID: Configured provider's ID. This can be found on the Providers page.
collection - Collection Name: Name of the collection this rule will work with. Configured and found in the Collections page.
collection - Collection Version: Version of the collection this rule will work with. Configured and found in the Collections page.
rule - type: (onetime|scheduled|sns|kinesis)
rule - value: This entry depends on the type of run.
  If it's a onetime rule, this can be left blank.
  If this is a scheduled rule, this field can hold a cron-type expression or rate expression. # Doc link below
  If this is an SNS rule #{SNS_topic_ARN},
  If this is a kinesis rule, this should be a configured ${Kinesis_stream_ARN} # See below
Rule state: (ENABLED|DISABLED)
Optional tags for search: Add additional tags to make searching easier. For example, adding a "nightly" tag to a rule that runs nightly.
```

**Please Note:**
* Rule with `Scheduled` type valid [values](https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html)
* An example of a one-time rule configuration can be found [here](./hello-world.md/#execution)
* Kinesis Rule configuration example [here](./cnm-workflow.md#rule-configuration)

