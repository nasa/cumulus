---
id: reindex-elasticsearch
title: Reindexing Elasticsearch Guide
hide_title: false
---

You may find yourself in a situation where you need to reindex your Elasticsearch index if you have issues with your
current index, or the mappings for an index have been updated (they do not update automatically). Any reindexing that will be required when upgrading Cumulus will be in the Migration Steps section of the changelog.

## Switch to a new index and Reindex

There are two operations needed: [reindex][reindex] and [change-index][change] to switch over to the new index. A Change Index/Reindex can be done in either order, but both have their trade-offs.

If you decide to point Cumulus to a new (empty) index first (with a change index operation), and then Reindex the data to the new index, data ingested while reindexing will automatically be sent to the new index. As reindexing operations can take a while, not all the data will show up on the Cumulus Dashboard right away. The advantage is you do not have to turn of any ingest operations. This way is recommended.

If you decide to Reindex data to a new index first, and then point Cumulus to that new index, it is not guaranteed that data that is sent to the old index while reindexing will show up in the new index. If you prefer this way, it is recommended to turn off any ingest operations. This order will keep your dashboard data from seeing any interruption.

### Change Index

This will point Cumulus to the index in Elasticsearch that will be used when retrieving data. Performing a change index operation to an index that does not exist yet will create the index for you. The change index operation can be found [here][change].

### Reindex from the old index to the new index

The reindex operation will take the data from one index and copy it into another index. The reindex operation can be found [here][reindex]

#### Reindex status

Reindexing is a long-running operation. The [reindex-status][status] endpoint can be used to monitor the progress of the operation.

## Index from database

If you want to just grab the data straight from the database you can perform an [Index from Database Operation](https://nasa.github.io/cumulus-api/unreleased/#index-from-database). After the data is indexed from the database, a  [Change Index operation][change] will need
to be performed to ensure Cumulus is pointing to the right index. It is **strongly recommended** to turn off
workflow rules when performing this operation so any data ingested to the database is not lost.

## Validate reindex

To validate the reindex, use the [reindex-status][status] endpoint. The doc count can be used to verify that the reindex was successful. In the below example the reindex from `cumulus-2020-11-3` to `cumulus-2021-3-4` was not fully successful as they show different doc counts.

```json
"indices": {
  "cumulus-2020-11-3": {
    "primaries": {
      "docs": {
        "count": 21096512,
        "deleted": 176895
      }
    },
    "total": {
      "docs": {
        "count": 21096512,
        "deleted": 176895
      }
    }
  },
  "cumulus-2021-3-4": {
    "primaries": {
      "docs": {
        "count": 715949,
        "deleted": 140191
      }
    },
    "total": {
      "docs": {
        "count": 715949,
        "deleted": 140191
      }
    }
  }
}
```

To further drill down into what is missing, log in to the Kibana instance (found in the Elasticsearch section of the AWS console) and run the following command replacing `<index>` with your index name.

```json
GET <index>/_search
{
  "aggs": {
        "count_by_type": {
            "terms": {
                "field": "_type"
            }
        }
    },
    "size": 0
}
```

which will produce a result like

```json
"aggregations": {
  "count_by_type": {
    "doc_count_error_upper_bound": 0,
    "sum_other_doc_count": 0,
    "buckets": [
      {
        "key": "logs",
        "doc_count": 483955
      },
      {
        "key": "execution",
        "doc_count": 4966
      },
      {
        "key": "deletedgranule",
        "doc_count": 4715
      },
      {
        "key": "pdr",
        "doc_count": 1822
      },
      {
        "key": "granule",
        "doc_count": 740
      },
      {
        "key": "asyncOperation",
        "doc_count": 616
      },
      {
        "key": "provider",
        "doc_count": 108
      },
      {
        "key": "collection",
        "doc_count": 87
      },
      {
        "key": "reconciliationReport",
        "doc_count": 48
      },
      {
        "key": "rule",
        "doc_count": 7
      }
    ]
  }
}
```

## Resuming a reindex

If a reindex operation did not fully complete it can be resumed using the following command run from the Kibana instance.

```json
POST _reindex?wait_for_completion=false
{
"conflicts": "proceed",
  "source": {
    "index": "cumulus-2020-11-3"
  },
  "dest": {
    "index": "cumulus-2021-3-4",
    "op_type": "create"
  }
}
```

The Cumulus API [reindex-status][status] endpoint can be used to monitor completion of this operation.

[status]: https://nasa.github.io/cumulus-api/unreleased/#reindex-status "Reindexing Elasticsearch Status"

[reindex]: https://nasa.github.io/cumulus-api/unreleased/#reindex "Reindexing Elasticsearch"

[change]: https://nasa.github.io/cumulus-api/unreleased/#change-index "Indexing Elasticsearch"
