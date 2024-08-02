//@ts-check

'use strict';

const router = require('express-promise-router')();

const cloneDeep = require('lodash/cloneDeep');
const merge = require('lodash/merge');

const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const {
  createRejectableTransaction,
  getKnexClient,
  isCollisionError,
  RulePgModel,
  RuleSearch,
  translateApiRuleToPostgresRuleRaw,
  translatePostgresRuleToApiRule,
} = require('@cumulus/db');
const { Search, getEsClient } = require('@cumulus/es-client/search');
const { indexRule, deleteRule } = require('@cumulus/es-client/indexer');

const {
  requireApiVersion,
} = require('../app/middleware');
const { isBadRequestError } = require('../lib/errors');
const {
  createRuleTrigger,
  deleteRuleResources,
  invokeRerun,
  updateRuleTrigger,
} = require('../lib/rulesHelpers');

const schemas = require('../lib/schemas.js');

const log = new Logger({ sender: '@cumulus/api/rules' });

/**
 * @typedef {import('@cumulus/types/api/rules').RuleRecord} RuleRecord
 */

/**
 * List all rules.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const dbSearch = new RuleSearch(
    { queryStringParameters: req.query }
  );

  const response = await dbSearch.query();
  return res.send(response);
}

/**
 * Query a single rule.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const name = req.params.name;

  const {
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};
  try {
    const rule = await rulePgModel.get(knex, { name });
    const result = await translatePostgresRuleToApiRule(rule, knex);
    return res.send(result);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('No record found');
    }
    throw error;
  }
}

/**
 * Creates a new rule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const {
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  let record;
  const apiRule = req.body || {};
  const name = apiRule.name;

  try {
    if (await rulePgModel.exists(knex, { name })) {
      return res.boom.conflict(`A record already exists for ${name}`);
    }

    apiRule.createdAt = Date.now();
    apiRule.updatedAt = Date.now();

    // Create rule trigger
    const ruleWithTrigger = await createRuleTrigger(apiRule);
    const postgresRule = await translateApiRuleToPostgresRuleRaw(ruleWithTrigger, knex);

    try {
      await createRejectableTransaction(knex, async (trx) => {
        const [pgRecord] = await rulePgModel.create(trx, postgresRule);
        record = await translatePostgresRuleToApiRule(pgRecord, knex);
      });
    } catch (innerError) {
      if (isCollisionError(innerError)) {
        return res.boom.conflict(`A record already exists for ${name}`);
      }
      throw innerError;
    }
    return res.send({ message: 'Record saved', record });
  } catch (error) {
    if (isBadRequestError(error)) {
      return res.boom.badRequest(error.message);
    }
    log.error('Error occurred while trying to create rule:', error);
    return res.boom.badImplementation(error.message);
  }
}

/**
 * Perform updates to an existing rule
 *
 * @param {object} params                   - params object
 * @param {object} params.res               - express response object
 * @param {RuleRecord} params.oldApiRule    - API 'rule' to update
 * @param {object} params.apiRule           - updated API rule
 * @param {object} params.rulePgModel       - @cumulus/db compatible rule module instance
 * @param {object} params.knex              - Knex object
 * @returns {Promise<object>} - promise of an express response object.
 */
async function patchRule(params) {
  const {
    res,
    oldApiRule,
    apiRule,
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
  } = params;

  log.debug(`rules.patchRule oldApiRule: ${JSON.stringify(oldApiRule)}, apiRule: ${JSON.stringify(apiRule)}`);
  let translatedRule;

  // If rule type is onetime no change is allowed unless it is a rerun
  if (apiRule.action === 'rerun') {
    return invokeRerun(oldApiRule).then(() => res.send(oldApiRule));
  }

  const apiRuleWithTrigger = await updateRuleTrigger(oldApiRule, apiRule);
  const apiPgRule = await translateApiRuleToPostgresRuleRaw(apiRuleWithTrigger, knex);
  log.debug(`rules.patchRule apiRuleWithTrigger: ${JSON.stringify(apiRuleWithTrigger)}`);

  await createRejectableTransaction(knex, async (trx) => {
    const [pgRule] = await rulePgModel.upsert(trx, apiPgRule);
    log.debug(`rules.patchRule pgRule: ${JSON.stringify(pgRule)}`);
    translatedRule = await translatePostgresRuleToApiRule(pgRule, knex);
  });

  log.info(`rules.patchRule translatedRule: ${JSON.stringify(translatedRule)}`);
  if (['kinesis', 'sns'].includes(oldApiRule.rule.type)) {
    await deleteRuleResources(knex, oldApiRule);
  }
  return res.send(translatedRule);
}

/**
 * Updates an existing rule.
 *
 * @param {object} req - express request object
 * @param {string} req.params.name - name of the rule to replace
 * @param {object} req.body - complete replacement rule
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object, which
 *    is a Bad Request (400) if the rule's name property does not match the
 *    name request parameter, or a Not Found (404) if there is no existing rule
 *    with the specified name
 */
async function patch(req, res) {
  const {
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
    esClient = await getEsClient(),
  } = req.testContext || {};

  const { params: { name }, body } = req;
  let apiRule = { ...body, updatedAt: Date.now() };

  if (apiRule.name && name !== apiRule.name) {
    return res.boom.badRequest(`Expected rule name to be '${name}', but found`
      + ` '${body.name}' in payload`);
  }

  try {
    const oldRule = await rulePgModel.get(knex, { name });
    const oldApiRule = await translatePostgresRuleToApiRule(oldRule, knex);

    apiRule.createdAt = oldApiRule.createdAt;
    apiRule = merge(cloneDeep(oldApiRule), apiRule);

    return await patchRule({ res, oldApiRule, apiRule, knex, esClient, rulePgModel });
  } catch (error) {
    log.error('Unexpected error when updating rule:', error);
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`Rule '${name}' not found`);
    }
    throw error;
  }
}

/**
 * Replaces an existing rule.
 *
 * @param {Object} req - express request object
 * @param {string} req.params.name - name of the rule to replace
 * @param {Object} req.body - complete replacement rule
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object, which
 *    is a Bad Request (400) if the rule's name property does not match the
 *    name request parameter, or a Not Found (404) if there is no existing rule
 *    with the specified name
 */
async function put(req, res) {
  const {
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  const { params: { name }, body } = req;

  // Nullify fields not passed in - we want to remove anything not specified by the user
  const nullifiedRuleTemplate = Object.keys(
    schemas.rule.properties
  ).reduce((acc, cur) => {
    acc[cur] = null;
    return acc;
  }, {});

  const apiRule = {
    ...nullifiedRuleTemplate,
    ...body,
    updatedAt: Date.now(),
  };

  if (name !== apiRule.name) {
    return res.boom.badRequest(`Expected rule name to be '${name}', but found`
      + ` '${body.name}' in payload`);
  }

  try {
    const oldRule = await rulePgModel.get(knex, { name });
    const oldApiRule = await translatePostgresRuleToApiRule(oldRule, knex);

    apiRule.createdAt = oldApiRule.createdAt;

    return await patchRule({ res, oldApiRule, apiRule, knex, rulePgModel });
  } catch (error) {
    log.error('Unexpected error when updating rule:', error);
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`Rule '${name}' not found`);
    }
    throw error;
  }
}

/**
 * deletes a rule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
  } = req.testContext || {};

  const name = (req.params.name || '').replace(/%20/g, ' ');

  let rule;
  let apiRule;

  try {
    rule = await rulePgModel.get(knex, { name });
    apiRule = await translatePostgresRuleToApiRule(rule, knex);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      // TODO probably don't need this catch.
      return res.boom.notFound('No record found');
    } else {
      throw error;
    }
  }

  await createRejectableTransaction(knex, async (trx) => {
    await rulePgModel.delete(trx, { name });
    if (rule) await deleteRuleResources(knex, apiRule);
  });

  return res.send({ message: 'Record deleted' });
}

router.get('/:name', get);
router.get('/', list);
router.patch('/:name', requireApiVersion(2), patch);
router.put('/:name', requireApiVersion(2), put);
router.post('/', post);
router.delete('/:name', del);

module.exports = {
  router,
  patch,
  post,
  put,
  del,
};
