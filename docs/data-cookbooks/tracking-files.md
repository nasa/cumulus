---
id: tracking-files
title: Tracking Files
hide_title: true
---

# Tracking Files

## Contents

* [Introduction](#introduction)
* [File Types](#file-types)
* [Collection Configuration](#collection-configuration)
* [Publish to CMR](#publish-to-cmr)
* [Common Use Cases](#common-use-cases)

### Introduction

This document covers setting up ingest to track primary and ancillary files under various file types, which will carry through to the CMR and granule record.
Cumulus has a number of options for tracking files and publishing files to CMR under certain metadata elements or with specified file types.
We will cover Cumulus file types, collection configuration, and effects on publishing to CMR.

### File types

Cumulus follows the Cloud Notification Mechanism (CNM) file type conventions. Under this schema, there are four data types:

* `data`
* `browse`
* `metadata`
* `qa`

In Cumulus, these data types are mapped to the `Type` attribute on `RelatedURL`s for UMM-G metadata, or used to map
resources to one of `OnlineAccessURL`, `OnlineResource` or `AssociatedBrowseImages` for ECHO10 XML metadata.

### Collection Configuration

File types for each file in a granule can be configured at the collection level as below:

```json
{
  "name": "MOD09GQ",
  "version": "006",
  "dataType": "MOD09GQ",
  "granuleId": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}$",
  "granuleIdExtraction": "(MOD09GQ\\..*)(\\.hdf|\\.cmr|_ndvi\\.jpg)",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
  "files": [
    {
      "bucket": "protected",
      "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.hdf$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.hdf",
      "fileType": "data"
    },
    {
      "bucket": "protected-2",
      "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\.cmr\\.xml$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104.cmr.xml",
      "fileType": "metadata"
    },
    {
      "bucket": "public",
      "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}_ndvi\\.jpg$",
      "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_ndvi.jpg",
      "fileType": "browse"
    }
  ]
}
```

Files on a particular granule which match a given file specification will be receive the provided `fileType` in the granule record,
which will then be used to inform CMR metadata updates in the publish step.

### Publish to CMR

When publishing granule metadata to CMR, the `PostToCmr` task will perform a few metadata updates in the area of URLs for its respective metadata schema.
The table below shows how the CNM data types map to CMR Metadata updates.
The UMM-G column reflects the `RelatedURL`'s `Type` derived from the CNM type, whereas the ECHO10 column shows how the CNM type affects the destination element.

|CNM Type |UMM-G Location |ECHO10 Location |
| ------  | ------ | ------ |
| `data` | `RelatedURL.Type = 'GET DATA'` | `OnlineAccessURL` |
| `browse` | `RelatedURL.Type = 'GET RELATED VISUALIZATION'` | `AssociatedBrowseImage` |
| `metadata` | `RelatedURL.Type = 'EXTENDED METADATA` | `OnlineResource` |
| `qa` | `RelatedURL.Type = 'EXTENDED METADATA'` | `OnlineResource` |

### Common Use Cases

This section briefly documents some common use cases and the recommended collection configuration for the file.

Configuring browse imagery:

```json
{
  "bucket": "public",
  "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\_[\\d]{1}.jpg$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_1.jpg",
  "fileType": "browse"
}  
```

Configuring a documentation entry:

```json
{
  "bucket": "protected",
  "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\_README.pdf$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_README.pdf",
  "fileType": "metadata"
}
```

Configuring other associated files (use fileTypes `metadata` or `qa` as appropriate):

```json
{
  "bucket": "protected",
  "regex": "^MOD09GQ\\.A[\\d]{7}\\.[\\S]{6}\\.006\\.[\\d]{13}\\_QA.txt$",
  "sampleFileName": "MOD09GQ.A2017025.h21v00.006.2017034065104_QA.txt",
  "fileType": "qa"
}
```
