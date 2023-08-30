import { NewRuleRecord, PartialRuleRecord } from '@cumulus/types/api/rules';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * Post a rule to the rules API
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.rule         - rule body to post
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output
 *                                       of the API lambda
 */
export const postRule = async (params: {
  prefix: string,
  rule: NewRuleRecord,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, rule, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/rules',
      body: JSON.stringify(rule),
    },
  });
};

/**
 * Replace a rule via PUT request.  Existing values will be removed if not specified
 * or set to null.
 * PUT /rules/${ruleName}
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.ruleName     - the rule to update
 * @param {Object} params.replacementRule  - complete replacement rule
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output of the API lambda
 */
export const replaceRule = async (params: {
  prefix: string,
  ruleName: string,
  replacementRule: NewRuleRecord & { action?: 'rerun' },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    ruleName,
    replacementRule,
    callback = invokeApi,
  } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: `/rules/${ruleName}`,
      body: JSON.stringify(replacementRule),
    },
  });
};

/**
 * Update a rule via PATCH request.  Existing values will not be overwritten if not
 * specified, null values will be removed.
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.ruleName     - the rule to update
 * @param {Object} params.updateParams - key/value to update on the rule
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                       that takes a prefix / user payload.  Defaults
 *                                       to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - promise that resolves to the output of the API lambda
 */
export const updateRule = async (params: {
  prefix: string,
  ruleName: string,
  updateParams: PartialRuleRecord & { action?: 'rerun' },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    ruleName,
    updateParams,
    callback = invokeApi,
  } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'PATCH',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: `/rules/${ruleName}`,
      body: JSON.stringify(updateParams),
    },
  });
};

/**
 * Get a list of rules from the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.query    - query params to use for listing rules
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
export const listRules = async (params: {
  prefix: string,
  query: { [key: string]: string },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, query = {}, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/rules',
      queryStringParameters: query,
    },
  });
};

/**
 * Get a rule definition from the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.ruleName - name of the rule
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>}      - promise that resolves to the output of the
 *                                   API lambda
 */
export const getRule = async (params: {
  prefix: string,
  ruleName: string,
  callback: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const {
    prefix,
    ruleName,
    callback = invokeApi,
  } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/rules/${ruleName}`,
    },
  });
};

/**
 * Delete a rule via the API
 *
 * @param {Object} params          - params
 * @param {string} params.prefix   - the prefix configured for the stack
 * @param {string} params.ruleName - name of the rule
 * @param {Object} params.callback - function to invoke the api lambda
 *                                   that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API lambda
 */
export const deleteRule = async (params: {
  prefix: string,
  ruleName: string,
  callback: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, ruleName, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/rules/${ruleName}`,
    },
  });
};

/**
 * Rerun a rule via the API.
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {string} params.ruleName     - the name of the rule to rerun
 * @param {Object} params.updateParams - key/value to update on the rule
 * @param {Object} params.callback     - function to invoke the api lambda
 *                                       that takes a prefix / user payload
 * @returns {Promise<Object>} - promise that resolves to the output of the API
 *    lambda
 */
export async function rerunRule(params: {
  prefix: string,
  ruleName: string,
  updateParams?: PartialRuleRecord,
  callback: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> {
  const {
    prefix,
    ruleName,
    updateParams = {},
    callback = invokeApi,
  } = params;

  return await updateRule({
    prefix,
    ruleName,
    updateParams: {
      ...updateParams,
      action: 'rerun',
    },
    callback,
  });
}
