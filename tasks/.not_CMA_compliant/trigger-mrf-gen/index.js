'use strict';

const Task = require('@cumulus/common/task');
const aws = require('@cumulus/common/aws');
const log = require('@cumulus/common/log');

/**
 * Converts a year and day of that year to a Date
 * @param {string} year The year
 * @param {string} day The day in that year (1-366)
 */
const dayOfYearToDate = (year, day) => {
  const y = parseInt(year, 10);
  const d = parseInt(day, 10);
  const date = new Date(y, 0);
  return new Date(date.setDate(d));
};

/**
 * Task which triggers MRFGen for each group of images in the payload
 *
 * Input payload: Array of objects { meta: {...}, payload: ... } which need processing
 * Output payload: none
 */
module.exports = class TriggerMrfGen extends Task {
  /**
   * Main task entry point
   * @return null
   */
  async run() {
    const executions = [];
    const executionPromises = [];
    const isSfnExecution = this.message.ingest_meta.message_source === 'sfn';

    if (!isSfnExecution) {
      log.warn(
        'TriggerProcessPdrTask only triggers AWS Step Functions. Running with inline triggers.'
      );
    }

    const stateMachine = this.config.workflow;
    const id = this.message.ingest_meta.id;
    const archiveFileNameRegex = new RegExp(this.message.meta.archive_file_name_regex);

    for (const e of this.message.payload.sources) {
      const archive = e.archive;
      const matches = archive.match(archiveFileNameRegex);
      const yearStr = matches[1];
      const dayOfYearStr = matches[2];
      const [year, month, day] = dayOfYearToDate(yearStr, dayOfYearStr)
        .toISOString()
        .split('T')[0]
        .split('-');

      const images = e.images;
      const keyElements = archive.split('.');
      const name = aws.toSfnExecutionName(keyElements.concat(id), '__');
      log.info(`Starting processing of ${name}`);

      const taskName = await aws.getCurrentSfnTask(
        this.message.ingest_meta.state_machine,
        this.message.ingest_meta.execution_name
      );

      // Store the list of images in S3 so as not to exceed our message size
      const scopedKey = [taskName, name].join('/');
      const params = {
        Bucket: this.message.resources.buckets.private,
        Key: scopedKey,
        Body: JSON.stringify(images)
      };
      const status = await aws.promiseS3Upload(params);
      const payload = { Bucket: status.Bucket, Key: status.Key };

      const fullMessageData = Object.assign({}, this.message);
      fullMessageData.meta = Object.assign({}, this.message.meta, {
        date: { year: year, month: month, day: day }
      });

      const originalIngestMeta = fullMessageData.ingest_meta;
      const newIngestMeta = { state_machine: stateMachine, execution_name: name };
      fullMessageData.ingest_meta = Object.assign({}, originalIngestMeta, newIngestMeta);

      const sfnMessageData = Object.assign({}, fullMessageData, { payload: payload });
      if (!isSfnExecution) {
        log.warn('inline-result: ', JSON.stringify(fullMessageData));
      }

      executions.push({
        stateMachineArn: stateMachine,
        input: JSON.stringify(sfnMessageData),
        name: name
      });
    }

    if (isSfnExecution) {
      for (const execution of executions) {
        executionPromises.push(
          aws
            .sfn()
            .startExecution(execution)
            .promise()
        );
      }
    }
    else {
      // For tests
      return executions;
    }

    await Promise.all(executionPromises);
    return null;
  }

  /**
   * Entry point for Lambda
   * @param {array} args The arguments passed by AWS Lambda
   * @return The handler return value
   */
  static handler(...args) {
    return TriggerMrfGen.handle(...args);
  }
};
