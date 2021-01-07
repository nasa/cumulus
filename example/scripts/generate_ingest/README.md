# generate_files

This lambda is used to generate 'random' MOD09GQ-like granules with fake data in batches of 100 and upload them to a target bucket/path.

## Usage

`node generate_files.js {bucket} {path} {number of 100 granule batches} `

## File Removal

Removing granules is as simple as utilizing the aws cli - sync an empty local directory with the `--delete` option:

```bash
// Remove dry-run to actually delete
aws s3 sync --dry-run --delete . s3://{bucket}/{path}
```

## Collection

A sample collection is included for ease of testing/setup in `./sample-collection`.   That collection has been used with the  `DiscoverGranules->IngestGranule` workflows
