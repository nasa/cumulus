/**
 * @module CloudwatchEvents
 */

import { cloudwatchevents } from './services';

/**
 * Create a CloudWatch Events rule
 *
 * @param {string} name - the rule name
 * @param {string} schedule - a ScheduleExpression
 * @param {string} state - the state of the rule
 * @param {string} [description]
 * @param {string} [role] - a Role ARN
 * @returns {Promise<CloudWatchEvents.PutRuleResponse>}
 */
export const putEvent = (
  name: string,
  schedule: string,
  state: string,
  description?: string,
  role?: string
) =>
  cloudwatchevents().putRule({
    Name: name,
    Description: description,
    RoleArn: role,
    ScheduleExpression: schedule,
    State: state,
  }).promise();

export const deleteEvent = (name: string) =>
  cloudwatchevents().deleteRule({ Name: name }).promise();

export const deleteTarget = (id: string, rule: string) =>
  cloudwatchevents().removeTargets({
    Ids: [id],
    Rule: rule,
  }).promise();

export const putTarget = (rule: string, id: string, arn: string, input: string) =>
  cloudwatchevents().putTargets({
    Rule: rule,
    Targets: [ /* required */
      {
        Arn: arn,
        Id: id,
        Input: input,
      },
    ],
  }).promise();
