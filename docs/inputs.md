# Ingest Inputs and Return Values

## General Structure

GIBS-in-the-Cloud uses a common format for all inputs and outputs from Tasks consisting of a JSON object which holds all necessary information about the task execution and AWS environment. Tasks return objects identical in format to their input with the exception of a task-specific `"payload"` field. Tasks may also augment their execution metadata.

## Data Sources

The Scheduler service creates the initial event by combining the collection configuration (See [collections.json](../config/collections.json)) with the AWS execution context provided by its [CloudFormation template](../config/cloudformation.yml.erb).  The collection configuration supports inheritance. If the `"parent"` attribute of a collection references the `"id"` of another collection, the other collection's fields will be recursively copied into the collection.

Because of the potential size of the `"payload"` field, it may contain a reference to an S3 Bucket and Key, as follows:

    {
      "payload" : {
        "Bucket" : "gitc-foo",
        "Key" : "bar/baz"
      }
    }

When a Task receives such a payload, it is responsible for fetching the JSON document at the given key and replacing `"payload"` with its contents.  See the (EventSource)[../lib/event-source.js] implementation for examples.

## URL Templating

When each task executes, it is expected to resolve URL templates found in its collection configuration against the entire collection configuration. For example, tasks should resolve the following collection:

    {
      "meta": { "name": "Hello" },
      "config" : { "output" : "{meta.name} World!" }
    }

Into this:

    {
      "meta": { "name": "Hello" },
      "config" : { "output" : "Hello World!" }
    }

URL template variables replace dotted paths inside curly brackets with their corresponding value. If a Task cannot resolve a value, it should ignore the template, leaving it verbatim in the string.  While seemingly complex, this allows significant decoupling of Tasks from one another and the data that drives them. Tasks are able to easily receive runtime configuration produced by previously run Tasks and domain data.

## Input Format

Below is the input format, annotated inline:

    {
      "resources": {             // External resources accessible to the Task. Tasks should generally
                                 // prefer to be passed resources explicitly in their configuration
                                 // rather than looking up paths here. The paths being present here,
                                 // however allows configuration to parameterize values that are
                                 // not known until the stack is created.  For instance, a configuration
                                 // field have the value "{resources.buckets.private}", which instructs
                                 // the Task to look up the private bucket while allowing the Task
                                 // to remain ignorant of what buckets are available.
        "stack": "<string>",     // The name of the Task's CloudFormation Task, useful as a prefix
        "buckets": {             // Names of S3 buckets available to the app.
          "config": "<string>",  // The name of the bucket holding configuration and deployment data
          "private": "<string>", // The name of the bucket which holds internal platform data
          "public": "<string>"   // The name of the bucket which holds data to be served publicly
        },
      },
      "collection": { ... },   // The full, original collection configuration, as specified in
                               // collections.json, with inheritance resolved. Tasks should not
                               // modify this but must pass it on.

      "meta": { ... },         // Metadata about this ingest execution. It is initialized to
                               // the "meta" attribute of the collection (or the empty object).
                               // Tasks may add fields to the "meta" object at will (in their
                               // returned output) in order to pass data to future tasks.
                               // Tasks should avoid assuming that fields are present in the
                               // meta object and avoid naming fields to put in the meta object,
                               // preferring instead to let configuration decide what goes into
                               // the object. See VIIRS discovery in collections.json for an example.
                               // It uses a field "addMeta" to determine which parts of a discovered
                               // URL should be added to the meta object under which fields.
                               // Subsequent tasks are told to read those fields by using JSON templates.

        "payload": ...         // A Task-specific payload. This can be any data type required by
                               // the Task. It can be considered the input and output of the Task,
                               // whereas the other fields are execution context. Tasks should
                               // document their expected payload input and output formats.
                               // Generally a Task will return an object which is nearly identical
                               // to its input in all fields but "payload", and "payload" will be
                               // completely different
    }

## Specific Payload Formats

### Remote Urls

Input to: sync-http-urls

Returned by: discover-http-tiles, sync-wms

    "payload": [             // Array of remote URLs
      {
         "url": "<string>",     // A single remote URL
         "version": "<string>"  // An opaque string that identifies the remote file version.
                                // This can be used to allow re-fetching of remote resources if
                                // the change but still have the same URL
      },
      ...                       // Potentially more URLs
    ]

### S3 Objects

Produced by: sync-http-urls

Input to: generate-mrf

    "payload": [               // Array of S3 objects
      {
        "Bucket": "<string>",  // The S3 bucket. The key's case convention is broken to
                               // maintain consistency with the S3 SDK/API. These objects
                               // can (and should) be passed verbatim to the SDK.
        "Key": "<string>"      // The S3 object's key.
      }
      ...                      // Potentially more objects
    ]

### null

Produced by: scheduler, discover-cmr-granules

Input to: All starting tasks

    "payload": null  // Or just leave it off
