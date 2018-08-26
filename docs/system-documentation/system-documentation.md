# How to Troubleshoot and Fix Issues

While Cumulus is a complex system, there is a focus on maintaining the integrity and availability of the system and data. Should you encounter errors or issues while using this system, this section will help troubleshoot and solve those issues.

## Backup and Restore

Cumulus has backup and restore functionality built-in to protect Cumulus data and allow recovery of a Cumulus stack. This is currently limited to Cumulus data and not full S3 archive data. Backup and restore is not enabled by default and must be enabled and configured to take advantage of this feature.

For more information, read the [Backup and Restore documentation](../data_in_dynamodb.md#backup-and-restore-with-aws).

## Elasticsearch reindexing

If new Elasticsearch mappings are added to Cumulus, they are automatically added to the index upon deploy. If you run into issues with your Elasticsearch index, a reindex operation is available via a command-line tool in the Cumulus API.

Information on how to reindex Elasticsearch is in the [Cumulus API package documentation](https://www.npmjs.com/package/@cumulus/api#reindexing-elasticsearch-indices).
