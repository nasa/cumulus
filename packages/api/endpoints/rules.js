'use strict';

const router = require('express-promise-router')();

const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const {
  createRejectableTransaction,
  getKnexClient,
  isCollisionError,
  RulePgModel,
  translateApiRuleToPostgresRule,
  translateApiRuleToPostgresRuleRaw,
  translatePostgresRuleToApiRule,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const { indexRule, deleteRule } = require('@cumulus/es-client/indexer');

const { isBadRequestError } = require('../lib/errors');
const models = require('../models');

const log = new Logger({ sender: '@cumulus/api/rules' });

/**
 * List all rules.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const table = 'rules';
  const queryParameters = req.query;
  const perPage = Number.parseInt((queryParameters.limit) ? queryParameters.limit : 10, 10)
  const currentPage = Number.parseInt((queryParameters.page) ? queryParameters.page : 1, 10);
  const knex = await getKnexClient();
  const response = await knex('rules').paginate({
    perPage,
    currentPage,
  });
  const results = response.data;
  const translatedResults = await Promise.all(results.map(async (ruleRecord) => await translatePostgresRuleToApiRule(ruleRecord, knex)));

  const queryResults = {
    results: translatedResults,
    meta: {
      ...response.pagination,
      stack: process.env.stackName,
      count: response.pagination.total,
      page: response.pagination.currentPage,
      table,
    }
  };

  return res.send(queryResults);
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
    ruleModel = new models.Rule(),
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  let record;
  const apiRule = req.body || {};
  const name = apiRule.name;

  try {
    if (await ruleModel.exists(name)) {
      return res.boom.conflict(`A record already exists for ${name}`);
    }

    apiRule.createdAt = Date.now();
    apiRule.updatedAt = Date.now();

    // Create rule trigger
    const ruleWithTrigger = await ruleModel.createRuleTrigger(apiRule);
    const postgresRule = await translateApiRuleToPostgresRule(ruleWithTrigger, knex);

    try {
      await createRejectableTransaction(knex, async (trx) => {
        await rulePgModel.create(trx, postgresRule);
        record = await ruleModel.create(ruleWithTrigger);
        await indexRule(esClient, record, process.env.ES_INDEX);
      });
    } catch (innerError) {
      if (isCollisionError(innerError)) {
        return res.boom.conflict(`A record already exists for ${name}`);
      }
      // Clean up DynamoDB record in case of any failure
      await ruleModel.delete(apiRule);
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
    ruleModel = new models.Rule(),
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const { params: { name }, body } = req;

  const apiRule = { ...body };
  let newRule;

  if (name !== apiRule.name) {
    return res.boom.badRequest(`Expected rule name to be '${name}', but found`
      + ` '${body.name}' in payload`);
  }

  try {
    const oldRule = await rulePgModel.get(knex, { name });
    const oldApiRule = await translatePostgresRuleToApiRule(oldRule, knex);

    // If rule type is onetime no change is allowed unless it is a rerun
    if (apiRule.action === 'rerun') {
      return models.Rule.invoke(oldApiRule).then(() => res.send(oldApiRule));
    }

    apiRule.updatedAt = Date.now();
    apiRule.createdAt = oldApiRule.createdAt;

    const fieldsToDelete = Object.keys(oldApiRule).filter(
      (key) => !(key in apiRule) && key !== 'createdAt'
    );

    const ruleWithUpdatedTrigger = await ruleModel.updateRuleTrigger(oldApiRule, apiRule);

    try {
      await createRejectableTransaction(knex, async (trx) => {
        // stores updated record in dynamo
        newRule = await ruleModel.update(ruleWithUpdatedTrigger, fieldsToDelete);
        // make sure we include undefined values so fields will be correctly unset in PG
        const postgresRule = await translateApiRuleToPostgresRuleRaw(newRule, knex);
        await rulePgModel.upsert(trx, postgresRule);
        await indexRule(esClient, newRule, process.env.ES_INDEX);
      });
      // wait to delete original event sources until all update operations were successful
      await ruleModel.deleteOldEventSourceMappings(oldApiRule);
    } catch (innerError) {
      if (newRule) {
        const ruleWithRevertedTrigger = await ruleModel.updateRuleTrigger(apiRule, oldApiRule);
        await ruleModel.update(ruleWithRevertedTrigger);
      }
      throw innerError;
    }

    return res.send(newRule);
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
    ruleModel = new models.Rule(),
    rulePgModel = new RulePgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const name = (req.params.name || '').replace(/%20/g, ' ');
  const esRulesClient = new Search(
    {},
    'rule',
    process.env.ES_INDEX
  );

  let apiRule;

  try {
    await rulePgModel.get(knex, { name });
  } catch (error) {
    // If rule doesn't exist in PG or ES, return not found
    if (error instanceof RecordDoesNotExist) {
      if (!(await esRulesClient.exists(name))) {
        log.info('Rule does not exist in Elasticsearch and PostgreSQL');
        return res.boom.notFound('No record found');
      }
      log.info('Rule does not exist in PostgreSQL, it only exists in Elasticsearch. Proceeding with deletion');
    } else {
      throw error;
    }
  }

  try {
    // Save DynamoDB rule to recreate record in case of deletion failure
    apiRule = await ruleModel.get({ name });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  try {
    await createRejectableTransaction(knex, async (trx) => {
      await rulePgModel.delete(trx, { name });
      await ruleModel.delete(apiRule);
      await deleteRule({
        esClient,
        name,
        index: process.env.ES_INDEX,
        ignore: [404],
      });
    });
  } catch (error) {
    // Delete is idempotent, so there may not be a DynamoDB
    // record to recreate
    if (apiRule) {
      await ruleModel.create(apiRule);
    }
    throw error;
  }

  return res.send({ message: 'Record deleted' });
}

router.get('/:name', get);
router.get('/', list);
router.put('/:name', put);
router.post('/', post);
router.delete('/:name', del);

module.exports = {
  router,
  post,
  put,
  del,
};
