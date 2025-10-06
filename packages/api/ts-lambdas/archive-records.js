"use strict";
'use-strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const range_1 = __importDefault(require("lodash/range"));
const moment_1 = __importDefault(require("moment"));
const db_1 = require("@cumulus/db");
const common_1 = require("@cumulus/common");
function getParsedConfigValues(config) {
    let recordType = 'granule';
    if (!config?.recordType) {
        common_1.log.warn('no recordType specified, in config, doing granules');
    }
    else if (!['granule', 'execution'].includes(config.recordType)) {
        common_1.log.warn('invalid recordType specified, in config, doing granules');
    }
    else {
        recordType = config.recordType;
    }
    const updateLimit = config?.updateLimit || 10000;
    const batchSize = config?.batchSize || 1000;
    const expirationDays = config?.expirationDays || 365;
    if (updateLimit <= 0) {
        throw new Error(`updateLimit must be a positive number greater than 0, got ${updateLimit}`);
    }
    if (batchSize <= 0) {
        throw new Error(`batchSize must be a positive number greater than 0, got ${batchSize}`);
    }
    if (expirationDays <= 0) {
        throw new Error(`expirationDays must be a positive number greater than 0, got ${expirationDays}`);
    }
    return {
        updateLimit,
        batchSize,
        expirationDays,
        recordType,
    };
}
/**
 * Performs granule update in batches in the database
 * @param config
 * @returns number of records that have actually been updated
 */
const archiveGranules = async (config) => {
    if (!(config.recordType === 'granule')) {
        return 0;
    }
    const { batchSize, updateLimit, expirationDays } = config;
    let totalUpdated = 0;
    const expirationDate = (0, moment_1.default)().subtract(expirationDays, 'd').toDate().toISOString();
    const granulePgModel = new db_1.GranulePgModel();
    const knex = await (0, db_1.getKnexClient)();
    for (const i of (0, range_1.default)(updateLimit / batchSize)) {
        // eslint-disable-next-line no-await-in-loop
        const updated = await granulePgModel.bulkArchive(knex, {
            limit: Math.min(batchSize, updateLimit - (i * batchSize)),
            expirationDate,
        });
        totalUpdated += updated;
        if (!updated) {
            break;
        }
    }
    return totalUpdated;
};
/**
 * Performs execution update in batches in the database
 * @param config
 * @returns number of records that have actually been updated
 */
const archiveExecutions = async (config) => {
    if (!(config.recordType === 'execution')) {
        return 0;
    }
    const { batchSize, updateLimit, expirationDays } = config;
    let totalUpdated = 0;
    const expirationDate = (0, moment_1.default)().subtract(expirationDays, 'd').toDate().toISOString();
    const knex = await (0, db_1.getKnexClient)();
    const executionPgModel = new db_1.ExecutionPgModel();
    for (const i of (0, range_1.default)(updateLimit / batchSize)) {
        // eslint-disable-next-line no-await-in-loop
        const updated = await executionPgModel.bulkArchive(knex, {
            limit: Math.min(batchSize, updateLimit - (i * batchSize)),
            expirationDate,
        });
        totalUpdated += updated;
        if (!updated) {
            break;
        }
    }
    return totalUpdated;
};
/**
 * Lambda handler to wrap all functionality
 * @param event
 * @returns object
 *   containing number of records updated
 */
async function handler(event) {
    const config = await getParsedConfigValues(event.config);
    common_1.log.info('running archive-records with config', JSON.stringify(config));
    const [granulesUpdated, executionsUpdated] = await Promise.all([
        archiveGranules(config),
        archiveExecutions(config),
    ]);
    return {
        granulesUpdated,
        executionsUpdated,
    };
}
exports.handler = handler;
exports.getParsedConfigValues = getParsedConfigValues;
//# sourceMappingURL=archive-records.js.map