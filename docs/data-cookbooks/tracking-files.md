---
id: tracking-files
title: Tracking Ancillary Files
hide_title: true
---

# Tracking Files

## Contents

* [Introduction](#introduction)
* [File Types](#file-types)
* [File Type Configuration](#file-type-configuration)
* [CMR Metadata](#cmr-metadata)
* [Common Use Cases](#common-use-cases)

### Introduction

This document covers setting up ingest to track primary and ancillary files under various file types, which will carry through to the CMR and granule record.
Cumulus has a number of options for tracking files in granule records, and in CMR metadata under certain metadata elements or with specified file types.
We will cover Cumulus file types, file type configuration, effects on CMR metadata, and some common use case examples.

### File types

Cumulus follows the Cloud Notification Mechanism (CNM) file type conventions. Under this schema, there are four data types:

* `data`
* `browse`
* `metadata`
* `qa`

In Cumulus, these data types are mapped to the `Type` attribute on `RelatedURL`s for UMM-G metadata, or used to map
resources to one of `OnlineAccessURL`, `OnlineResource` or `AssociatedBrowseImages` for ECHO10 XML metadata.

### File Type Configuration

File types for each file in a granule can be configured in a number of different ways, depending on the ingest type and workflow.
For more information, see the [ancillary metadata](../features/ancillary_metadata) documentation.

### CMR Metadata

When updating granule CMR metadata, the `MoveGranules` task will add the external facing URLs to the CMR metadata file based on the file type.
The table below shows how the CNM data types map to CMR metadata updates. Non-CNM file types are handled as 'data' file types.
The UMM-G column reflects the `RelatedURL`'s `Type` derived from the CNM type, whereas the ECHO10 column shows how the CNM type affects the destination element.

|CNM Type |UMM-G `RelatedUrl.Type` |ECHO10 Location |
| ------  | ------ | ------ |
| `data` | `'GET DATA'` | `OnlineAccessURL` |
| `browse` | `'GET RELATED VISUALIZATION'` | `AssociatedBrowseImage` |
| `metadata` | `'EXTENDED METADATA'` | `OnlineResource` |
| `qa` | `'EXTENDED METADATA'` | `OnlineResource` |

### Common Use Cases

This section briefly documents some common use cases and the recommended configuration for the file.
The examples shown here are for the DiscoverGranules use case, which allows configuration at the Cumulus dashboard level.
The other two cases covered in the [ancillary metadata](../features/ancillary_metadata) documentation require configuration at the provider notification level (either CNM message or PDR) and are not covered here.

Configuring browse imagery:

```json
{
  "bucket": "public",
  "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\_[\\d]{1}.jpg$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_1.jpg",
  "type": "browse"
}  
```

Configuring a documentation entry:

```json
{
  "bucket": "protected",
  "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\_README.pdf$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_README.pdf",
  "type": "metadata"
}
```

Configuring other associated files (use types `metadata` or `qa` as appropriate):

```json
{
  "bucket": "protected",
  "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\_QA.txt$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_QA.txt",
  "type": "qa"
}
```
