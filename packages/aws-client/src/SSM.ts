/**
 * @module SSM
 */

import { ssm } from './services';

/**
 * Get the value of an SSM parameter
 *
 * @param {string} Name - name of the SSM parameter
 * @returns {Promise<string | undefined>} the parameter value, or undefined if the parameter has
 *   no value
 * @throws {ParameterNotFound} if the parameter does not exist
 */
export const getParameterValue = async (Name: string): Promise<string | undefined> => {
  const response = await ssm().getParameter({ Name });
  return response.Parameter?.Value;
};
