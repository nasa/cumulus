---
id: setup
title: Data Cookbooks Setup
hide_title: true
---

# Setup

### Getting setup to work with data-cookboooks

In the following data cookbooks we'll go through things like setting up workflows, making configuration changes, and interacting with CNM. The point of this section is to set up, or at least better understand, collections, providers, and rules and how they are configured.


### Schemas

Looking at our api schema [definitions](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) can provide us with some insight into collections, providers, rules, and their attributes (and whether those are required or not). The schema for different concepts will be reference throughout this document.

**Note:** The schemas are _extremely_ useful for understanding what attributes are configurable and which of those are required. Indeed, they are what the Cumulus code validates definitions (whether that be collection, provider, or others) against. Much of this document is simply providing some context to the information in the schemas.


### Collections

Collections are logical sets of data objects of the same data type and version. A collection provides contextual information used by Cumulus ingest. We have a few [test collections](https://github.com/nasa/cumulus/tree/master/example/data/collections) configured in Cumulus source for integration testing. Collections can be viewed, edited, added, and removed from the Cumulus dashboard under the "Collections" navigation tab. Additionally, they can be managed via the [collections api](https://nasa.github.io/cumulus-api/?language=Python#list-collections).

The schema for collections can be found [here](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) as the object assigned to `module.exports.collection` and tells us all about what values are expected, accepted, and required in a collection object (where required attribute keys are assigned as a string to the `required` attribute).

**Break down of [s3_MOD09GQ_006.json](https://github.com/nasa/cumulus/tree/master/example/data/collections/s3_MOD09GQ_006.json)**

|Key  |Value  |Required  |Description|
|:---:|:-----:|:--------:|-----------|
|name |`"MOD09GQ"`|Yes|The name attribute designates the name of the collection. This is the name under which the collection will be displayed on the dashboard|
|version|`"006"`|Yes|A version tag for the collection|
|granuleId|`"^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}$"`|Yes|REGEX to match granuleId extracted via granuleIdExtraction|
|granuleIdExtraction|<code>"(MOD09GQ\\..*)(\\.hdf&#124;\\.cmr&#124;_ndvi\\.jpg)"</code>|Yes|REGEX that extracts a granuleId from filename|
|sampleFileName|`"MOD09GQ.A2017025.h21v00.006.2017034065104.hdf"`|Yes|An example filename belonging to this collection|
|files|`<JSON Object>` of files defined [here](#files-object)|Yes|Describe the individual files that will exist for each granule in this collection (size, browse, meta, etc.)|
|dataType|`"MOD09GQ"`|No|Can be specified, but this value will default to the collection_name if not|
|duplicateHandling|`"replace"`|No|<code>("replace"&#124;"version"&#124;"skip")</code> determines granule duplicate handling scheme|
|process|`"modis"`|No|The options for this are found in the ChooseProcess step definition in [sips.yml](https://github.com/nasa/cumulus/tree/master/example/workflows/sips.yml)|
|provider_path|`"cumulus-test-data/pdrs"`|No|This collection is expecting to find data in a `cumulus-test-data/pdrs` directory, whether that be in S3 or at an http endpoint|
|meta|`<JSON Object>` of MetaData for the collection|No|MetaData for the collection. This metadata will be available to workflows for this collection via the [Cumulus Message Adapter](workflows/input_output.md).
|url_path|`"{cmrMetadata.Granule.Collection.ShortName}/`<br/>`{substring(file.name, 0, 3)}"`|No|Filename without extension|


#### files-object
|Key  |Value  |Required  |Description|
|:---:|:-----:|:--------:|-----------|
|regex|`"^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.hdf$"`|Yes|Regex used to identify the file|
|sampleFileName|`MOD09GQ.A2017025.h21v00.006.2017034065104.hdf"`|Yes|Filename used to validate the provided regex|
|type|`"data"`|No|Value to be assigned to the Granule File Type. CNM types are used by Cumulus CMR steps, non-CNM values will be treated as 'data' type.  Currently only utilized in DiscoverGranules task|
|bucket|`"internal"`|Yes|Name of the bucket where the file will be stored|
|url_path|`"${collectionShortName}/{substring(file.name, 0, 3)}"`|No|Folder used to save the granule in the bucket. Defaults to the collection url_path|


### Providers

Providers generate and distribute input data that Cumulus obtains and sends to workflows. Schema for providers can be found [here](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) in the object assigned to `module.exports.provider`. A few example provider configurations can be found [here](https://github.com/nasa/cumulus/tree/master/example/data/providers). Providers can be viewed, edited, added, and removed from the Cumulus dashboard under the "Providers" navigation tab. Additionally, they can be managed via the [providers api](https://nasa.github.io/cumulus-api/?language=Python#list-providers).

**Break down of [s3_provider.json](https://github.com/nasa/cumulus/tree/master/example/data/providers/s3_provider.json):**

|Key  |Value  |Required|Description|
|:---:|:-----:|:------:|-----------|
|id|`"s3_provider"`|Yes|Unique identifier for provider|
|globalConnectionLimit|`10`|Yes|Integer specifying the connection limit to the provider|
|protocol|`s3`|Yes|<code>(http&#124;https&#124;ftp&#124;sftp&#124;s3)</code> are current valid entries|
|host|`"cumulus-data-shared"`|Yes|Host where the files will exist or s3 bucket if "s3" provider|
|port|`${port_number}`|No|Port to connect with the provider on|
|username|`${username}`|No|Username for access to the provider. Plain-text or encrypted. Encrypted is highly encouraged|
|password|`${password}`|No|Password for accces to the provider. Plain-text or encrypted. Encrypted is highly encouraged|

_The above optional attributes are not shown in the example provided, but they have been included in this document for completeness_


### Rules

Rules are used by to start processing workflows and the transformation process. Rules can be invoked manually, based on a schedule, or can be configured to be triggered by either events in [Kinesis](data-cookbooks/cnm-workflow.md) or SNS messages. The current best way to understand rules is to take a look at the [schema](https://github.com/nasa/cumulus/tree/master/packages/api/models/schemas.js) (specifically the object assigned to `module.exports.rule`). Rules can be viewed, edited, added, and removed from the Cumulus dashboard under the "Rules" navigation tab. Additionally, they can be managed via the [rules api](https://nasa.github.io/cumulus-api/?language=Python#list-rules).

The Cumulus Core repository has an example of a Kinesis rule [here](https://github.com/nasa/cumulus/blob/master/example/data/rules/L2_HR_PIXC_kinesisRule.json).
An example of an SNS rule configuration is [here](https://github.com/nasa/cumulus/blob/master/example/spec/parallel/testAPI/snsRuleDef.json).

|Key  |Value  |Required|Description|
|:---:|:-----:|:------:|-----------|
|name|`"L2_HR_PIXC_kinesisRule"`|Yes|Name of the rule. This is the name under which the rule will be listed on the dashboard|
|workflow|`"CNMExampleWorkflow"`|Yes|Name of the workflow to be run. A list of available workflows can be found on the Workflows page|
|provider|`"PODAAC_SWOT"`|No|Configured provider's ID. This can be found on the Providers dashboard page|
|collection|`<JSON Object>` collection object shown [below](#collection-object)|Yes|Name and version of the collection this rule will moderate. Relates to a collection configured and found in the Collections page|
|rule|`<JSON Object>` rule type and associated values - discussed [below](#rule-object)|Yes|Object defining the type and subsequent attributes of the rule|
|state|`"ENABLED"`|No|<code>("ENABLED"&#124;"DISABLED")</code> whether or not the rule will be active. Defaults to `"ENABLED"`.|
|tags|`["kinesis", "podaac"]`|No|An array of strings that can be used to simplify search|

#### collection-object
|Key  |Value  |Required|Description|
|:---:|:-----:|:------:|-----------|
|name|`"L2_HR_PIXC"`|Yes|Name of a collection defined/configured in the Collections dashboard page|
|version|`"000"`|Yes|Version number of a collection defined/configured in the Collections dashboard page|

#### rule-object
|Key|Value|Required|Description|
|:---:|:-----:|:------:|-----------|
|type|`"kinesis"`|Yes|<code>("onetime"&#124;"scheduled"&#124;"kinesis"&#124;"sns")</code> type of scheduling/workflow kick-off desired|
|value|`<String> Object`|Depends|Discussion of valid values is [below](#rule-value)|


#### rule-value
The `rule - value` entry depends on the type of run:
  * If this is a onetime rule this can be left blank. [Example](data-cookbooks/hello-world.md/#execution)
  * If this is a scheduled rule this field must hold a valid [cron-type expression or rate expression](https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html).
  * If this is a kinesis rule, this must be a configured `${Kinesis_stream_ARN}`. [Example](data-cookbooks/cnm-workflow.md#rule-configuration)
  * If this is an sns rule, this must be an existing `${SNS_Topic_Arn}`. [Example](https://github.com/nasa/cumulus/blob/master/example/spec/parallel/testAPI/snsRuleDef.json)
