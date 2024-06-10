# Generate DB records

This script (generate_db_records.js) is meant to push up large quantities of realistic cumulus database entries for scaled testing purposes

## Installation
This can be installed with npm install in this directory (or will be installed as a part of cumulus when installing the whole of cumulus-core)

generate_db_records.js is tested to run with both node v16.19.0 and v20.12.2

## Configuration
the script can be configured either through command line arguments of environment variables (or both), preferring command line arguments if both are supplied

| Argument    | Environment | Default | Description | 
| --- | :----: | :----: | ---: |
| --collections <br> --num_collections | COLLECTIONS | 1 | number of collections. number of granules will be <br> for *each* collection, not divided among them |
| --granules_k <br> granules| GRANULES_K | 10 | number of granules, in thousands |
| --executionsPerGranule <br> --executions_to_granule <br> --executions_to_granules <br> --executions_per_granule | EXECUTIONS_PER_GRANULE | 2:2 | number of executions *x* per <br> batch of granules *g* in format 'x:g' <br> \<executionsPerBatch>:\<granulesPerBatch> |
| --files <br> --files_per_gran | FILES | 1 | number of files per granule |
| --concurrency | CONCURRENCY | 1 | how many threads of parallelization |
| --variance | VARIANCE |  false | randomize executions and granules per batch, <br> adding up to 6 granules and or executions to a given batch |

concurrency should usually be >100, 