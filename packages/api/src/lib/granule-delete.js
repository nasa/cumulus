"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const p_map_1 = __importDefault(require("p-map"));
const S3_1 = require("@cumulus/aws-client/S3");
const db_1 = require("@cumulus/db");
const errors_1 = require("@cumulus/errors");
const logger_1 = __importDefault(require("@cumulus/logger"));
const { deleteGranule } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const FileUtils = require('../../lib/FileUtils');
const Granule = require('../../models/granules');
const logger = new logger_1.default({ sender: '@cumulus/api/granule-delete' });
/**
 * Delete a list of files from S3
 *
 * @param {Array} files - A list of S3 files
 * @returns {Promise<void>}
 */
const _deleteS3Files = async (files = []) => await p_map_1.default(files, async (file) => {
    await S3_1.deleteS3Object(FileUtils.getBucket(file), FileUtils.getKey(file));
});
/**
 * Delete a Granule from Postgres and Dynamo, delete the Granule's
 * Files from Postgres and S3
 *
 * @param {Object} params
 * @param {Knex} params.knex - DB client
 * @param {Object} params.dynamoGranule - Granule from DynamoDB
 * @param {PostgresGranule} params.pgGranule - Granule from Postgres
 * @param {FilePgModel} params.filePgModel - File Postgres model
 * @param {GranulePgModel} params.granulePgModel - Granule Postgres model
 * @param {Object} params.granuleModelClient - Granule Dynamo model
 */
const deleteGranuleAndFiles = async (params) => {
    const { knex, dynamoGranule, pgGranule, filePgModel = new db_1.FilePgModel(), granulePgModel = new db_1.GranulePgModel(), granuleModelClient = new Granule(), esClient = await Search.es(), } = params;
    if (pgGranule === undefined) {
        logger.debug(`PG Granule is undefined, only deleting DynamoDB granule ${JSON.stringify(dynamoGranule)}`);
        // Delete only the Dynamo Granule and S3 Files
        await _deleteS3Files(dynamoGranule.files);
        await granuleModelClient.delete(dynamoGranule);
    }
    else if (pgGranule.published) {
        throw new errors_1.DeletePublishedGranule('You cannot delete a granule that is published to CMR. Remove it from CMR first');
    }
    else {
        // Delete PG Granule, PG Files, Dynamo Granule, S3 Files
        logger.debug(`Initiating deletion of PG granule ${JSON.stringify(pgGranule)} mapped to dynamoGranule ${JSON.stringify(dynamoGranule)}`);
        const files = await filePgModel.search(knex, { granule_cumulus_id: pgGranule.cumulus_id });
        try {
            await knex.transaction(async (trx) => {
                await granulePgModel.delete(trx, {
                    cumulus_id: pgGranule.cumulus_id,
                });
                await granuleModelClient.delete(dynamoGranule);
                await deleteGranule({
                    esClient,
                    granuleId: dynamoGranule.granuleId,
                    collectionId: dynamoGranule.collectionId,
                    index: process.env.ES_INDEX,
                    ignore: [404],
                });
            });
            logger.debug(`Successfully deleted granule ${pgGranule.granule_id}`);
            await _deleteS3Files(files);
        }
        catch (error) {
            logger.debug(`Error deleting granule with ID ${pgGranule.granule_id} or S3 files ${JSON.stringify(dynamoGranule.files)}: ${JSON.stringify(error)}`);
            // Delete is idempotent, so there may not be a DynamoDB
            // record to recreate
            if (dynamoGranule) {
                await granuleModelClient.create(dynamoGranule);
            }
            throw error;
        }
    }
};
module.exports = {
    deleteGranuleAndFiles,
};
//# sourceMappingURL=granule-delete.js.map