# Generate Records

These scripts (generate_db_records.js and generate_db_executions.js) are meant to push up large quantities of realistic cumulus database entries for scaled testing purposes

## Installation
This can be installed with npm install in this directory (or will be installed as a part of cumulus when installing the whole of cumulus-core)

generate_db_records.js and generate_db_executions.js are tested to run with both node v20/v22

## generate_db_records.js
This is the default script for uploading bulk data to a cumulus database. it is granule oriented, handling files, executions and granule-executions with respect to granules and as such is well optimized for most database mocking applications. Its performance is dependent on there being a significant number (>= concurrency) of granules in order to parallelize well, and so will be sub-optimal for uploading only files, executions etc.

### Configuration
the script can be configured either through command line arguments or environment variables (or both), preferring command line arguments if both are supplied

| Argument    | Environment | Default | Description |
| --- | :----: | :----: | ---: |
| --collections <br>-c | COLLECTIONS | 1 | number of collections. number of granules will be <br> for *each* collection, not divided among them |
| --granulesK <br> -g| GRANULES_K | 10 | number of granules, in thousands |
| --executionsPerGranule <br> -e | EXECUTIONS_PER_GRANULE | 2:2 | number of executions *x* per <br> batch of granules *g* in format 'x:g' <br> \<executionsPerBatch>:\<granulesPerBatch> |
| --files <br> -f | FILES | 1 | number of files per granule |
| --concurrency <br> -C | CONCURRENCY | 1 | how many threads of parallelization <br> concurrency should usually be >100 |
| --variance <br> -v| VARIANCE |  false | randomize executions and granules per batch, <br> adding up to 6 granules and or executions to a given batch |
| --swallowErrors <br> -s|SWALLOW_ERRORS| true | swallow and move on from data data upload errors |

## generate_db_executions.js
This script is designed up upload a large number of executions. it will also add in final_payload and original_payload fields at random with a small payload.

### Configuration
the script can be configured either through command line arguments or environment variables (or both), preferring command line arguments if both are supplied

| Argument    | Environment | Default | Description |
| --- | :----: | :----: | ---: |
| --collections <br>-c | COLLECTIONS | 1 | number of collections. number of executions will be <br> for *each* collection, not divided among them |
| --executionsK <br> -g| EXECUTIONS_K | 10 | number of executions, in thousands |
| --concurrency <br> -C | CONCURRENCY | 1 | how many threads of parallelization <br> concurrency should usually be >100 |
| --swallowErrors <br> -s|SWALLOW_ERRORS| true | swallow and move on from data data upload errors |

