# Setup

### Getting setup to work with data-cookboooks

In the following data cookbooks we'll go through things like setting up workflows, making configuration changes, and interacting with CNM. The point of this section is to set up, or at least better understand collections, providers, and rules and how they are configured.


### Schemas

Looking at our api schema [definitions](https://github.com/nasa/cumulus/blob/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/packages/api/models/schemas.js) can provide us with some insight into collections, providers, rules, and their attributes (and whether those are required or not). The schema for different concepts will be reference throughout this document.


### Collections

Collections are logical sets of data objects of the same data type and version. We have a few [test collections](https://github.com/nasa/cumulus/tree/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/example/data/collections) configured in Cumulus source for integration testing. Collections can be viewed, edited, added, and removed from the Cumulus dashboard under the "Collections" navigation tab. Additionally, they can be managed via the [collections api](https://nasa.github.io/cumulus-api/?language=Python#list-collections).

The schema for collections can be found [here](https://github.com/nasa/cumulus/blob/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/packages/api/models/schemas.js#L4) and tells us all about what values are expected, accepted, and [required](https://github.com/nasa/cumulus/blob/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/packages/api/models/schemas.js#L109) in a collection object.

**Break down of [s3_MOD09GQ_006.json](https://github.com/nasa/cumulus/blob/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/example/data/collections/s3_MOD09GQ_006.json)**

**Required:**
```
"name": "MOD09GQ": The name attribute designates the name of the collection. This is the name under which the collection will be displayed on the dashboard.
"version": "006": A version tag for the collection. # TODO
"process": modis": I'm assuming this has to do with the lambda used to process this data # TODO
"provider_path": "cumulus-test-data/pdrs": This collection is expecting to find data in a `cumulus-test-data/pdrs` directory, whether that be in S3 or at an http endpoint. # TODO
"granuleId": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$": REGEX to match granuleId. # TODO
"granuleIdExtraction": "(MOD09GQ\\..*)(\\.hdf|\\.cmr|_ndvi\\.jpg)": REGEX to match granuleIdExtraction. # TODO
"sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf": # TODO
"files": ...: # TODO
"createdAt": # TODO
"updatedAt": # TODO
```

**Optional:**
```
"provider_path": "granules/fake_granules": # TODO
"dataType": "MOD09GQ": # TODO
"duplicateHandling": "replace": (replace | ) # TODO
"url_path": "{cmrMetadata.Granule.Collection.ShortName}/{substring(file.name, 0, 3)}": # TODO
```


### Providers

Providers ingest, archive, process, and distribute satellite data on-demand. They generate input data. Schema for providers can be found [here](https://github.com/nasa/cumulus/blob/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/packages/api/models/schemas.js#L383). A few example provider configurations can be found [here](https://github.com/nasa/cumulus/tree/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/example/data/providers). Providers can be viewed, edited, added, and removed from the Cumulus dashboard under the "Providers" navigation tab. Additionally, they can be managed via the [providers api](https://nasa.github.io/cumulus-api/?language=Python#list-providers).

**Break down of [s3_provider.json](https://github.com/nasa/cumulus/blob/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/example/data/providers/s3_provider.json):**

**Required:**
```
"id" = "s3_provider":
"globalConnectionLimit": 10
"protocol": "s3"
"host": "cumulus-data-shared"
```


### Rules

Rules are used by operators to start processing workflows and the transformation process. Rules can be invoked manually or based on a schedule. The current best way to understand rules is to take a look at the [schema](https://github.com/nasa/cumulus/blob/713ae01458ef278fa75d1cc0c6d68e00ffd4ce33/packages/api/models/schemas.js#L231). Rules can be viewed, edited, added, and removed from teh Cumulus dashboard under the "Rules" navigation tab. Additionally, they can be managed via the [rules api](https://nasa.github.io/cumulus-api/?language=Python#list-rules).

We don't currently have examples of rules in the Cumulus repo, but we can see how to create a rule from the Cumulus dashboard.
1. In the Cumulus dashboard, click the `Rules` navigation button.
2. Click `Add a rule`.

```
name: Name of the rule. This is the name under which the rule will be displayed in the dashboard.
Workflow Name: name of the workflow you're going to run. A list of available workflows can be found on the Workflows page.
Provider ID: Configured provider's ID. This can be found on the Providers page.
collection - Collection Name: Name of the collection this rule will work with. Configured and found in the Collections page.
collection - Collection Version: Version of the collection this rule will work with. Configured and found in the Collections page.
rule - type: (onetime|scheduled|sns|kinesis)
rule - value: This entry depends on the type of run.
  If it's a onetime rule, this can be left blank.
  If this is a scheduled rule, this field can hold a cron-type expression.
  If this is an SNS rule, # TODO
  If this is a kinesis rule, # TODO
Rule state: (ENABLED|DISABLED)
Optional tags for search: Add additional tags to make searching easier. For example, adding a "nightly" tag to a rule that runs nightly.
```

