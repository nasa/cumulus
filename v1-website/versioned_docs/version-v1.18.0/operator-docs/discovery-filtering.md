---
id: version-v1.18.0-discovery-filtering
title: Discovery Filtering
hide_title: true
original_id: discovery-filtering
---

# Discovery Filtering

Discovery filtering is an advanced feature of the `discover-granules` and `discover-pdrs` tasks.
It is a configurable option for discovery that allows an operator to manipulate which parts of a
remote file system Cumulus will attempt discovery in.

This is useful when operators want to limit run time or network load when attempting discovery on a
very large remote file system for a small subset of files.

## Using discovery filtering

This feature is available for certain ingest protocols (see below), and allows operators
to filter which paths on a remote file system are explored by interpreting each segment of the
collection's `provider_path` as a regular expression to filter contents listed recursively,
starting from the default directory.

Items that fail the filter are ignored.
An item that passes the filter is handled depending on its type:

- *Directories* that pass the filter are **recurred into** for further recursive listing.
- *Files* that pass the filter are **appended** to the final output returned by the discovery.

Two example values for `collection.provider_path` are provided below to help explain the recursive filtering algorithm:

```json
{
  "provider_path": "(MOD0.*)/PDR/"
}
```

The path shown above will:

- list contents of the default directory,
- append or recur into any item matching `MOD0.*`, e.g. `MOD09GQ`,
- append or recur into any item in directories from the previous step named `PDR`,
- append and recur into everything in `PDR` without filtering anything out.

```json
{
  "provider_path": "daily/(199.)/data/(.*.nc)"
}
```

The path shown above will:

- list contents of the default directory,
- append or recur into any item named `daily`,
- append or recur into any item in `daily` that matches `199.`, e.g. '1997',
- append or recur into any item in directories from the previous step named `data`,
- append or recur into all items that end in `.nc`,
- append or recur into everything in any directories that ended in `.nc` without filtering anything out.

**Note**: each discovery task performs its own post-discovery filtering on some relevant
value, e.g. `granuleIdExtraction` for discover-granules, so discovery filtering is intended to
be used primarily to limit unnecessary exploration of large file systems, *not* to filter for
specific files.

## Troubleshooting

An error during recursive filtering causes the algorithm to back out and default to attempting to
directly list the `provider_path`. If the path contains regular expression components, this may fail.

It is recommended that operators diagnose any failures by checking error logs and ensuring that
permissions on the remote file system allow reading of the default directory and any subdirectories
that match the filter.

## Supported protocols

Currently support for this feature is limited to the following protocols:

- ftp
- sftp
