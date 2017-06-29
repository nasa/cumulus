# Cumulus Configuration and Message Protocol

This document describes the Cumulus configuration file and the messages that are passed between tasks.

# Configuration and Message Use Diagram

<img src="images/cumulus_configuration_and_message_schema_diagram.png">

* **Configuration** - The Cumulus configuration file defines everything needed to describe an instance of Cumulus. See details in the [Configuration section](#configuration) below.
* **Scheduler** - This starts ingest of a collection on configured intervals.
* **Input to Step Functions** - The Scheduler uses the Configuration as source data to construct the input to the Workflow. See the [Message Protocol section](#message-protocol) for details on how the configuration is used to
* **AWS Step Functions** - Run the workflows as kicked off by the scheduler or other processes.
* **Input to Task** - The input for each task is a JSON document that conforms to the message schema.
* **Output from Task** - The output of each task must conform to the message schemas as well and is used as the input for the subsequent task.

## Configuration

The Cumulus configuration file defines everything needed to describe an instance of Cumulus. This includes:

* **Provider configuration** - A list of providers and settings that apply at the provider level.
* **Workflows** - The Step Functions defined using the [AWS Step Function State Language](http://docs.aws.amazon.com/step-functions/latest/dg/amazon-states-language.html#amazon-states-language).
* **Collections** - Settings specific for ingesting data for a collection. This includes:
  * **Workflow** - a reference to a workflow at the top level that will allow ingesting the collection.
  * **Triggers** - Settings indicating how an ingest is started for a collection.
  * **Meta** - An element that is open for extension allowing the definition of any collection level configuration items needed.
  * **Workflow Task Configuration** - Templates that specify the configurations for each of the tasks that run within a workflow.

### URL Templating

When each task executes, it is expected to resolve URL templates found in its collection configuration against the entire collection configuration. For example, tasks should resolve the following collection:

```JSON
{
  "meta": { "name": "Hello" },
  "config" : { "output" : "{meta.name} World!" }
}
```

Into this:

```JSON
{
  "meta": { "name": "Hello" },
  "config" : { "output" : "Hello World!" }
}
```

URL template variables replace dotted paths inside curly brackets with their corresponding value. If a Task cannot resolve a value, it should ignore the template, leaving it verbatim in the string.  This allows decoupling tasks from one another and the data that drives them. Tasks are able to easily receive runtime configuration produced by previously run Tasks and domain data.

### Configuration JSON Schema and Example

[Download Configuration Schema](/schemas/collections_config_schema.json)

[Download Example Configuration](/schemas/example-data/example-collection.json)

#### Generated Schema Documentation

<script src="docson/widget.js" data-schema="/schemas/merged-collections_config_schema.json">
</script>

## Message Protocol

The Message Protocol defines the the data that is used as input to individual workflow tasks. This includes:

* **Ingest Metadata** - Information about the current running ingest like what time it started and the name of the workflow.
* **Meta** - The `meta` element copied from the collection configuration. This will usually contain information about the collection like its id.
* **Provider** - Settings specific to the current provider.
* **Workflow Task Configuration** - Templates that specify the configurations for each of the tasks that run within a workflow.
* **Resources** - The set of external resources accessible to the task like S3 buckets to use or table names.
* **Exception** - A field to indicate a task failure.
* **Payload** - The main data produced by a task or used as input to the next task would go in this element.

### Creating the Workflow Input from the Configuration

The input to a workflow is generated from the Configuration and some other sources. This details the sources of the top level fields for the input.

* **Ingest Metadata** - Generated at the beginning of a new ingest.
* **Meta** - Copied from the collection configuration.
* **Provider** - Copied from the collection configuration.
* **Workflow Task Configuration** - Copied from the collection configuration.
* **Resources** - The resources are defined during the deployment of Cumulus and specified in the Scheduler configuration.
* **Exception** - Set to `'None'` initially.
* **Payload** - Set to `null` initially.

### Message Protocol Schema and Example

[Download Message Schema](/schemas/message_schema.json)

[Download Example Message](/schemas/example-data/example-message-envelope.json)

#### Generated Schema Documentation

<script src="docson/widget.js" data-schema="/schemas/merged-message_schema.json">
</script>

## Common Schema Types

The Ingest Common JSON Schema defines common types for other JSON schemas.

[Download Common Schema](/schemas/ingest_common_schema.json)

<script src="docson/widget.js" data-schema="/schemas/merged-ingest_common_schema.json$definitions/ProviderType">
</script>
<script src="docson/widget.js" data-schema="/schemas/merged-ingest_common_schema.json$definitions/WorkflowConfigTemplateType">
</script>
