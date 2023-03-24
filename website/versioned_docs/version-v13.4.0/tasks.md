---
id: tasks
title: Cumulus Tasks
hide_title: false
---

A list of reusable Cumulus tasks. [Add your own.](adding-a-task.md)

> **NOTE:** For a detailed description of each task, visit the task's `README.md`. Information on the  input or output of a task is specified in the task's `schemas` directory.

## Tasks

### [@cumulus/add-missing-file-checksums](https://github.com/nasa/cumulus/tree/master/tasks/add-missing-file-checksums#readme)

Add checksums to files in S3 which don't have one

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/add-missing-file-checksums#readme) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/add-missing-file-checksums#readme/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/add-missing-file-checksums) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/discover-granules](https://github.com/nasa/cumulus/tree/master/tasks/discover-granules)

Discover Granules in FTP/HTTP/HTTPS/SFTP/S3 endpoints

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/discover-granules) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/discover-granules/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/discover-granules) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/discover-pdrs](https://github.com/nasa/cumulus/tree/master/tasks/discover-pdrs)

Discover PDRs in FTP and HTTP endpoints

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/discover-pdrs) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/discover-pdrs/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/discover-pdrs) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/files-to-granules](https://github.com/nasa/cumulus/tree/master/tasks/files-to-granules)

Converts array-of-files input into a granules object by extracting granuleId from filename

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/files-to-granules) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/files-to-granules/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/files-to-granules) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/hello-world](https://github.com/nasa/cumulus/tree/master/tasks/hello-world)

Example task

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/hello-world) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/hello-world/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/hello-world) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/hyrax-metadata-updates](https://github.com/nasa/cumulus/tree/master/tasks/hyrax-metadata-updates)

Update granule metadata with hooks to OPeNDAP URL

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/hyrax-metadata-updates) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/hyrax-metadata-updates/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/hyrax-metadata-updates) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/lzards-backup](https://github.com/nasa/cumulus/tree/master/tasks/lzards-backup#readme)

Run LZARDS backup

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/lzards-backup#readme) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/lzards-backup#readme/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/lzards-backup) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/move-granules](https://github.com/nasa/cumulus/tree/master/tasks/move-granules)

Move granule files from staging to final location

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/move-granules) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/move-granules/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/move-granules) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/parse-pdr](https://github.com/nasa/cumulus/tree/master/tasks/parse-pdr)

Download and Parse a given PDR

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/parse-pdr) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/parse-pdr/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/parse-pdr) | [source](https://github.com/nasa/cumulus).

---

### [@cumulus/pdr-status-check](https://github.com/nasa/cumulus/tree/master/tasks/pdr-status-check)

Checks execution status of granules in a PDR

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/pdr-status-check) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/pdr-status-check/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/pdr-status-check) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/post-to-cmr](https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr)

Post a given granule to CMR

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/post-to-cmr) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/queue-granules](https://github.com/nasa/cumulus/tree/master/tasks/queue-granules)

Add discovered granules to the queue

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/queue-granules) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/queue-granules/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/queue-granules) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/queue-pdrs](https://github.com/nasa/cumulus/tree/master/tasks/queue-pdrs)

Add discovered PDRs to a queue

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/queue-pdrs) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/queue-pdrs/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/queue-pdrs) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/queue-workflow](https://github.com/nasa/cumulus/tree/master/tasks/queue-workflow)

Add workflow to the queue

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/queue-workflow) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/queue-workflow/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/queue-workflow) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/sf-sqs-report](https://github.com/nasa/cumulus/tree/master/tasks/sf-sqs-report)

Sends an incoming Cumulus message to SQS

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/sf-sqs-report) for additonal information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/sf-sqs-report/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/sf-sqs-report) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/sync-granule](https://github.com/nasa/cumulus/tree/master/tasks/sync-granule)

Download a given granule

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/sync-granule) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/sync-granule/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/sync-granule) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/test-processing](https://github.com/nasa/cumulus/tree/master/tasks/test-processing)

Fake processing task used for integration tests

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/test-processing) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/test-processing/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/test-processing) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/update-cmr-access-constraints](https://github.com/nasa/cumulus/tree/master/tasks/update-cmr-access-constraints#readme)

Updates CMR metadata to set access constraints

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/update-cmr-access-constraints#readme) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/update-cmr-access-constraints#readme/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/update-cmr-access-constraints) | [source](https://github.com/nasa/cumulus)

---

### [@cumulus/update-granules-cmr-metadata-file-links](https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links)

Update CMR metadata files with correct online access urls and etags and transfer etag info to granules' CMR files

- Readme: Check out the [README](https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links) for additional information.
- Schemas: See this module's [schema definitions](https://github.com/nasa/cumulus/tree/master/tasks/update-granules-cmr-metadata-file-links/schemas).
- Resources: [npm](https://npmjs.com/package/@cumulus/update-granules-cmr-metadata-file-links) | [source](https://github.com/nasa/cumulus)
