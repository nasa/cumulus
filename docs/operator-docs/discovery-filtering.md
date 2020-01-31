---
id: discovery-filtering
title: Discovery Filtering
hide_title: true
---

# Discovery Filtering

Discovery filtering is an advanced feature of the discover-* tasks.
It is a configurable option for discovery that allows an operator to manipulate which parts of a
remote file system Cumulus will attempt discovery in.

This is useful when operators want to limit run time or network load when attempting discovery on a
very large remote file system for a small subset of files.

## Using discovery filtering

This feature is available for certain ingest protocols (see below), and allows operators
to filter which paths on a remote file system are explored by interpreting each segment of the
collection's `provider_path` as a regular expression to filter contents listed recursively,
starting from the default directory.

An item that passes the filter is handled depending on its type:

- *Directories* that pass the filter are entered for recursive listing
- *Files* that pass the filter are added to the listed contents returned by the discovery.

Two examples are provided below to help explain the recursive filtering algorithm:

```json
{
  "provider_path": "(MOD0.*)/PDR/"
}
```

The path shown above will list the default directory, list or recur on any item matching `MOD0.*`,
e.g. `MOD09GQ`, and in each directory list or recur on any item named `PDR`. After entering a `PDR`
directory, it will list and recur on everything as there is no further filtering to apply.

```json
{
  "provider_path": "daily/(199.)/data/(.*.nc)"
}
```

The path shown above will list the default directory, list or recur on any item named `daily`,
then list or recur on any item that matches `199.`, e.g. '1997', then list or recur on any item
named `data`, and finally list or recur on all items that end in `.nc` without filtering in any
subdirectories.

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
