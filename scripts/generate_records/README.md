# Generate DB records

This script (generate_db_records.js) is meant to push up large quantities of realistic cumulus database entries for scaled testing purposes

## Installation
This can be installed with npm install in this directory (or will be installed as a part of cumulus when installing the whole of cumulus-core)

generate_db_records.js is tested to run with both node v16.19.0 and v20.12.2

## Configuration
the script can be configured either through command line arguments or environment variables (or both), preferring command line arguments if both are supplied

| Argument    | Environment | Default | Description | 
| --- | :----: | :----: | ---: |
| --collections <br>-c | COLLECTIONS | 1 | number of collections. number of granules will be <br> for *each* collection, not divided among them |
| --granules_k <br> -g| GRANULES_K | 10 | number of granules, in thousands |
| --executionsPerGranule <br> -e | EXECUTIONS_PER_GRANULE | 2:2 | number of executions *x* per <br> batch of granules *g* in format 'x:g' <br> \<executionsPerBatch>:\<granulesPerBatch> |
| --files <br> -f | FILES | 1 | number of files per granule |
| --concurrency <br> -C | CONCURRENCY | 1 | how many threads of parallelization <br> concurrency should usually be >100 |
| --variance <br> -v| VARIANCE |  false | randomize executions and granules per batch, <br> adding up to 6 granules and or executions to a given batch |
| --swallowErrors <br> -s|SWALLOW_ERRORS| true | swallow and move on from data data upload errors |

