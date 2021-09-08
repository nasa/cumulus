const {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  GranulesExecutionsPgModel,
} = require('@cumulus/db');

const Logger = require('@cumulus/logger');
const { getExecutionCumulusId, getGranuleCumulusId } = require('./utils');

const logger = new Logger({ sender: '@cumulus/api/lib/writeRecords/write-execution' });

const writeGranuleExecutionRecord = async ({
  granuleId,
  collectionId,
  execution,
  knex,
  collectionPgModel = new CollectionPgModel(),
  executionPgModel = new ExecutionPgModel(),
  granulePgModel = new GranulePgModel(),
  granuleExecutionPgModel = new GranulesExecutionsPgModel(),
}) => {
  const granuleCumulusId = await getGranuleCumulusId(
    granuleId, collectionId, knex, collectionPgModel, granulePgModel
  );
  if (granuleCumulusId === undefined) {
    throw new Error(`Could not find granule in PostgreSQL database with granuleId ${granuleId} collectionId ${collectionId}`);
  }

  const executionCumulusId = await getExecutionCumulusId(execution, knex, executionPgModel);
  if (executionCumulusId === undefined) {
    throw new Error(`Could not find execution in PostgreSQL database with url ${execution}`);
  }

  const postgresRecord = {
    granule_cumulus_id: granuleCumulusId,
    execution_cumulus_id: executionCumulusId,
  };
  return await knex.transaction(async (trx) => {
    logger.info(`About to write granule execution ${granuleId} ${collectionId} ${execution} to PostgreSQL`);
    const returnPgRecord = await granuleExecutionPgModel.upsert(trx, postgresRecord);
    logger.info(`Successfully wrote granule execution ${granuleId} ${collectionId} ${execution} to PostgreSQL with cumulus_id ${JSON.stringify(returnPgRecord)}`);
    return returnPgRecord;
  });
};

module.exports = {
  writeGranuleExecutionRecord,
};
