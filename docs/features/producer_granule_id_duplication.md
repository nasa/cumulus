---
id: granule-uniquification
title: Granule Uniquification
---

## **Overview**

The Granule Uniquification feature in Cumulus allows for the ingestion and management of multiple granules that share the same `granuleId` but belong to different collections. This is achieved by creating a unique `granuleId` for each granule and storing the original, non-unique identifier in a new field called `producerGranuleId`.

This feature is critical for systems migrating from ECS and other workflows where `granuleId` may not be globally unique.    Existing workflows that have no need for this feature should be compatible with no changes, however the end result will be the `granuleId` and `producerGranuleId` will be set to the same value if producerGranuleId is not specified.

This feature was added in Cumulus version 21, this document provides an overview of the feature and high level changes associated with the feature from previous versions.

---

## Schema Changes

* **`granuleId`**: This field remains unchanged in the Core schema, and remains a unique identifier for a granule within the Cumulus system. For granules that originally had a different `granuleId` via Cumulus Core Task Components or a provider provided identifier, this value will be a combination of the original `granuleId` and a configurable hash.

Downstream consumers of Cumulus granule objects should not need to make modifications related to this field.   Core will be moving away from API and other concepts that relate to identifying granule objects by `granuleId` + `collectionId` in future versions.

* **`producerGranuleId`**: This new field is intended to store the original, non-unique producer granule identification value.    This allows for traceability and correlation with the provider's source data.

If using Cumulus Core reference Task Components this value will be retained from the original `granuleId`.    If using another process, or the provider is providing uniqified IDs, it's expected that `producerGranuleId` will be populated with an appropriate value.

Downstream consumers of Cumulus granules objects should update to make use of this field if they intend to directly reference `producerGranuleId` or need to reconcile their records to provider records directly.

## Updated Workflow Task Components

The following tasks have been added or updated from prior versions to handle and/or allow conversion to use the new `producerGranuleId` field:

* Added
  * `AddUniqueGranuleId`
* Updated
  * `SyncGranules`
  * `QueueGranules`
  * `UpdateGranulesCmrMetadataFileLinks`
  * `FilesToGranules`

## Updated Cumulus Framework Behaviors

* The API will now allow for updates/writing of `producerGranuleId`.    This field is

## **The Uniquification Process**

When a workflow is configured to utilize any of the new workflow tasks, Cumulus uses a hashing algorithm to generate a unique suffix that is appended to the original `granuleId`. This process is handled by the `add-unique-granule-id` task or can be integrated into other tasks like `parse-pdr`.

The algorithm generates an MD5 hash of the granule's `collectionId` (and optionally a timestamp) and appends a truncated version of this hash to the `producerGranuleId` to create the new unique `granuleId`.

For more details on the algorithm and for implementations in other languages, see the [Granule Uniquification for External Tooling](./developer-guide/external-tooling-granule-uniquification.md) guide.

---

## **Configuration**

Most of the task Granule uniquification can be enabled and configured at the collection level, or optionally be provided via workflow configuration or some other workflow `meta` field.    In the Cumulus reference implementations, it is suggested to add the following to the `collection.meta` object:

```json
"meta": {
  "uniquifyGranuleId": true,
  "hashLength": 8
}

Example usage to set `hashLength` in the AddUniqueGranuleId task:

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
            "hashLength": "{$.meta.collection.meta.hashLength}"
          }
        }
      },
...
```
