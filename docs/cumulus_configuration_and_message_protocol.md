# Cumulus Configuration and Message Protocol

Cumulus defines two schemas for its configuration and the message protocol between tasks.

* Cumulus Configuration File - defines the workflows, triggers, tasks, and configuration for ingesting data. The configuration file allows an operator to compose the different runtime components and set them up in AWS.
* Message Protocol - Defines the input and output format of data sent to and received by tasks.

## Configuration and Message Use Diagram

<img src="images/cumulus_configuration_and_message_schema_diagram.png>

## Configuration

The workflows, schedule, tasks, and configuration for ingesting data is configured via a JSON configuration file. The configuration file allows an operator to compose the different runtime components and set them up in AWS.

* **Leverages Existing Work**
  * The design leverages the existing work of Amazon by defining workflows using the [AWS Step Function State Language](http://docs.aws.amazon.com/step-functions/latest/dg/amazon-states-language.html#amazon-states-language). This is the language that was created for describing the state machines used in AWS Step Functions.
* **Open for Extension**
  * Both `meta` and `workflow_config_template` which are used for configuring at the collection and task levels do not dictate the fields and structure of the configuration. Additional task specific JSON schemas can be used for extending the validation of individual steps.  
* **Data-centric Configuration**
  * The use of a single JSON configuration file allows this to be added to a workflow. We build additional support on top of the configuration file for simpler domain specific configuration or interactive GUIs.

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


### Configuration JSON Schema

The Configuration JSON Schema defines the Ingest configured workflows and tasks.

[Download Configuration Schema](/schemas/collections_config_schema.json)

[Download Example Configuration](/schemas/example-data/example-collection.json)

<script src="docson/widget.js" data-schema="/schemas/merged-collections_config_schema.json">
</script>


## Message Protocol

The Envelope JSON schema defines the structure of the message sent to and returned from tasks.

[Download Message Schema](/schemas/envelope_schema.json)

[Download Example Message](/schemas/example-data/example-message-envelope.json)

<script src="docson/widget.js" data-schema="/schemas/merged-envelope_schema.json">
</script>

## Common Schema Types

The Ingest Common JSON Schema defines common types for other JSON schemas.

[Download Common Schema](/schemas/ingest_common_schema.json)

<script src="docson/widget.js" data-schema="/schemas/merged-ingest_common_schema.json$definitions/ProviderType">
</script>
<script src="docson/widget.js" data-schema="/schemas/merged-ingest_common_schema.json$definitions/WorkflowConfigTemplateType">
</script>
