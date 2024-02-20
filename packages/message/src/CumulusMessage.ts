/**
 * Check for QueueExecutionLimits Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is QueueExecutionLimits}
 */
export const isQueueExecutionLimit = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && Object.values(obj).reduce(
    (correct, value) => (correct && value instanceof Number),
    true
  )
);

/**
* Check for CumulusMeta Type
*
* @param {{ [key: string]: any }} obj
* @returns {obj is CumulusMeta}
*/
export const isCumulusMeta = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'execution_name' in obj && obj.execution_name instanceof String
  && 'state_machine' in obj && obj.Key instanceof String
  && 'queueExecutionLimits' in obj && isQueueExecutionLimit(obj.queueExecutionLimits)
);

/**
 * Check for ReplaceConfig Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is ReplaceConfig}
 */
export const isReplacConfig = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'Bucket' in obj && obj.Bucket instanceof String
  && 'Key' in obj && obj.Key instanceof String
);

/**
* Check for Meta Type
*
* @param {{ [key: string]: any }} obj
* @returns {obj is Meta}
*/
export const isMeta = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'workflow_name' in obj && obj.workflow_name instanceof String
);

/**
 * Check for CumulusMessage Type
 *
 * @param {{ [key: string]: any }} obj
 * @returns {obj is CumulusMessage}
 */
export const isCumulusMessage = (obj: { [key: string]: any }): boolean => (
  obj instanceof Object
  && 'cumulus_meta' in obj && isCumulusMeta(obj.cumulus_meta)
  && 'meta' in obj && isMeta(obj.meta)
  && 'payload' in obj
);
