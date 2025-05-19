---
id: version-v5.0.1-reindex-elasticsearch
title: Reindexing Elasticsearch Guide
hide_title: false
original_id: reindex-elasticsearch
---

You may find yourself in a situation where you need to reindex your Elasticsearch index. If you have issues with your
current index, or the mappings for an index have been updated (they do not update automatically), there are two ways
to get the data synced correctly. Any reindexing that will be required when upgrading Cumulus will be in the Migration Steps section of the changelog.

## Switch to a new index and Reindex

The first way involves reindexing from the existing Elasticsearch index and pointing Cumulus to the new index. A Change Index/Reindex can be done in either order, but both have their trade-offs.

If you decide to point Cumulus to a new (empty) index first (with a change index operation), and then Reindex the data to the new index, data ingested while reindexing will automatically be sent to the new index. As reindexing operations can take a while, not all the data will show up on the Cumulus Dashboard right away. The advantage is you do not have to turn of any ingest operations. This way is recommended.

If you decide to Reindex data to a new index first, and then point Cumulus to that new index, it is not guaranteed that data that is sent to the old index while reindexing will show up in the new index. If you prefer this way, it is recommended to turn off any ingest operations. This order will keep your dashboard data from seeing any interruption.

### Change Index

This will point Cumulus to the index in Elasticsearch that will be used when retrieving data. Performing a change index operation to an index that does not exist yet will create the index for you. The change index operation can be found [here](https://nasa.github.io/cumulus-api/#change-index).

### Reindex from the old index to the new index

The reindex operation will take the data from one index and copy it into another index. The reindex operation can be found [here](https://nasa.github.io/cumulus-api/#reindex)

## Index from database

If you want to just grab the data straight from the database you can perform an [Index from Database Operation](https://nasa.github.io/cumulus-api/#index-from-database). After the data is indexed from the database, a  [Change Index operation](https://nasa.github.io/cumulus-api/#change-index) will need
to be performed to ensure Cumulus is pointing to the right index. It is **strongly recommended** to turn off
workflow rules when performing this operation so any data ingested to the database is not lost.
