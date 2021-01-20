---
id: reindex-elasticsearch
title: Reindexing Elasticsearch Guide
hide_title: false
---

You may find yourself in a situation where you need to reindex your Elasticsearch index. If you have issues with your
current index, or the mappings for an index have been updated (they do not update automatically), there are two ways
to get the data synced correctly.

## Change Index and Reindex

The first way involves reindexing from the existing Elasticsearch index to a brand new index. This is done in two steps.

### Change Index

It is recommended to change Cumulus to point to an empty index first. This will allow new data to be passed to the index without
interruption. The change index operation can be found [here](https://nasa.github.io/cumulus-api/#change-index)

### Reindex from the old index to the new index

After changing to a fresh index, you can reindex the data in the old index into the new index. The reindex
operation can be found [here](https://nasa.github.io/cumulus-api/#reindex)

## Index from database

If you want to just grab the data straight from the database you can perform an [Index from Database Operation](https://nasa.github.io/cumulus-api/#index-from-database). After the data is indexed from the database, a  [Change Index operation](https://nasa.github.io/cumulus-api/#change-index) will need
to be performed to ensure Cumulus is pointing to the right index. It is **strongly recommended** to turn off
workflow rules when performing this operation so any data ingested to the database is not lost.
