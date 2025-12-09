//@ts-check

'use strict';

const router = require('express-promise-router')();

const cloneDeep = require('lodash/cloneDeep');
const merge = require('lodash/merge');

const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

// Import OpenTelemetry
const { trace } = require('@opentelemetry/api');

const {
  createRejectableTransaction,
  getKnexClient,
  isCollisionError,
  RulePgModel,
  RuleSearch,
  translateApiRuleToPostgresRuleRaw,
  translatePostgresRuleToApiRule,
} = require('@cumulus/db');

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

// Get the tracer
const tracer = trace.getTracer('cumulus-api-rules');

/**
 * @typedef {import('@cumulus/types/api/rules').RuleRecord} RuleRecord
 */

/**
 * List all rules.
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function list(req, res) {
  return tracer.startActiveSpan('rules.list', async (span) => {
    try {
      span.setAttribute('rules.has_query_params', Object.keys(req.query).length > 0);

      const dbSearch = new RuleSearch(
        { queryStringParameters: req.query }
      );

      const response = await dbSearch.query();

      span.setAttribute('rules.result_count', response?.meta?.count || 0);
      span.setAttribute('rules.results_returned', response?.results?.length || 0);

      return res.send(response);
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Query a single rule.
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function get(req, res) {
  return tracer.startActiveSpan('rules.get', async (span) => {
    try {
      const name = req.params.name;

      span.setAttribute('rule.name', name);

      const {
        rulePgModel = new RulePgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      try {
        const rule = await tracer.startActiveSpan('rulePgModel.get', async (dbSpan) => {
          try {
            return await rulePgModel.get(knex, { name });
          } finally {
            dbSpan.end();
          }
        });

        const result = await tracer.startActiveSpan('translatePostgresRuleToApiRule', async (translateSpan) => {
          try {
            return await translatePostgresRuleToApiRule(rule, knex);
          } finally {
            translateSpan.end();
          }
        });

        span.setAttribute('rule.type', result.rule?.type);
        span.setAttribute('rule.state', result.state);

        return res.send(result);
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('rule.not_found', true);
          return res.boom.notFound('No record found');
        }
        throw error;
      }
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Creates a new rule
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function post(req, res) {
  return tracer.startActiveSpan('rules.post', async (span) => {
    try {
      const {
        rulePgModel = new RulePgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      let record;
      const apiRule = req.body || {};
      const name = apiRule.name;

      span.setAttribute('rule.name', name);
      span.setAttribute('rule.type', apiRule.rule?.type);
      span.setAttribute('rule.state', apiRule.state);
      span.setAttribute('rule.workflow', apiRule.workflow);

      try {
        if (await rulePgModel.exists(knex, { name })) {
          span.setAttribute('rule.already_exists', true);
          return res.boom.conflict(`A record already exists for ${name}`);
        }

        apiRule.createdAt = Date.now();
        apiRule.updatedAt = Date.now();

        // Create rule trigger
        const ruleWithTrigger = await tracer.startActiveSpan('createRuleTrigger', async (triggerSpan) => {
          try {
            triggerSpan.setAttribute('rule.type', apiRule.rule?.type);
            return await createRuleTrigger(apiRule);
          } finally {
            triggerSpan.end();
          }
        });

        const postgresRule = await translateApiRuleToPostgresRuleRaw(ruleWithTrigger, knex);

        try {
          await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
            try {
              await createRejectableTransaction(knex, async (trx) => {
                const [pgRecord] = await rulePgModel.create(trx, postgresRule);
                record = await translatePostgresRuleToApiRule(pgRecord, knex);
              });
            } finally {
              txSpan.end();
            }
          });
        } catch (innerError) {
          if (isCollisionError(innerError)) {
            span.setAttribute('rule.collision', true);
            return res.boom.conflict(`A record already exists for ${name}`);
          }
          throw innerError;
        }

        return res.send({ message: 'Record saved', record });
      } catch (error) {
        if (isBadRequestError(error)) {
          span.setAttribute('rule.validation_error', true);
          span.recordException(error);
          span.setAttribute('error', true);
          return res.boom.badRequest(error.message);
        }
        log.error('Error occurred while trying to create rule:', error);
        span.recordException(error);
        span.setAttribute('error', true);
        return res.boom.badImplementation(error.message);
      }
    } finally {
      span.end();
    }
  });
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
  return tracer.startActiveSpan('rules.patchRule', async (span) => {
    try {
      const {
        res,
        oldApiRule,
        apiRule,
        rulePgModel = new RulePgModel(),
        knex = await getKnexClient(),
      } = params;

      span.setAttribute('rule.name', oldApiRule.name);
      span.setAttribute('rule.type', oldApiRule.rule?.type);
      span.setAttribute('rule.old_state', oldApiRule.state);
      span.setAttribute('rule.new_state', apiRule.state);
      span.setAttribute('rule.action', apiRule.action);

      log.debug(`rules.patchRule oldApiRule: ${JSON.stringify(oldApiRule)}, apiRule: ${JSON.stringify(apiRule)}`);
      let translatedRule;

      // If rule type is onetime no change is allowed unless it is a rerun
      if (apiRule.action === 'rerun') {
        span.setAttribute('rule.is_rerun', true);
        await tracer.startActiveSpan('invokeRerun', async (rerunSpan) => {
          try {
            await invokeRerun(oldApiRule);
          } finally {
            rerunSpan.end();
          }
        });
        return res.send(oldApiRule);
      }

      const apiRuleWithTrigger = await tracer.startActiveSpan('updateRuleTrigger', async (triggerSpan) => {
        try {
          triggerSpan.setAttribute('rule.type', oldApiRule.rule?.type);
          return await updateRuleTrigger(oldApiRule, apiRule);
        } finally {
          triggerSpan.end();
        }
      });

      const apiPgRule = await translateApiRuleToPostgresRuleRaw(apiRuleWithTrigger, knex);
      log.debug(`rules.patchRule apiRuleWithTrigger: ${JSON.stringify(apiRuleWithTrigger)}`);

      await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
        try {
          await createRejectableTransaction(knex, async (trx) => {
            const [pgRule] = await rulePgModel.upsert(trx, apiPgRule);
            log.debug(`rules.patchRule pgRule: ${JSON.stringify(pgRule)}`);
            translatedRule = await translatePostgresRuleToApiRule(pgRule, knex);
          });
        } finally {
          txSpan.end();
        }
      });

      log.info(`rules.patchRule translatedRule: ${JSON.stringify(translatedRule)}`);

      if (['kinesis', 'sns'].includes(oldApiRule.rule.type)) {
        span.setAttribute('rule.requires_resource_cleanup', true);
        await tracer.startActiveSpan('deleteRuleResources', async (cleanupSpan) => {
          try {
            cleanupSpan.setAttribute('rule.type', oldApiRule.rule.type);
            await deleteRuleResources(knex, oldApiRule);
          } finally {
            cleanupSpan.end();
          }
        });
      }

      return res.send(translatedRule);
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
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
  return tracer.startActiveSpan('rules.patch', async (span) => {
    try {
      const {
        rulePgModel = new RulePgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      const { params: { name }, body } = req;
      let apiRule = { ...body, updatedAt: Date.now() };

      span.setAttribute('rule.name', name);

      if (apiRule.name && name !== apiRule.name) {
        span.setAttribute('rule.name_mismatch', true);
        return res.boom.badRequest(`Expected rule name to be '${name}', but found`
          + ` '${body.name}' in payload`);
      }

      try {
        const oldRule = await tracer.startActiveSpan('rulePgModel.get', async (dbSpan) => {
          try {
            return await rulePgModel.get(knex, { name });
          } finally {
            dbSpan.end();
          }
        });

        const oldApiRule = await translatePostgresRuleToApiRule(oldRule, knex);

        apiRule.createdAt = oldApiRule.createdAt;
        apiRule = merge(cloneDeep(oldApiRule), apiRule);

        span.setAttribute('rule.type', apiRule.rule?.type);
        span.setAttribute('rule.workflow', apiRule.workflow);

        return await patchRule({ res, oldApiRule, apiRule, knex, rulePgModel });
      } catch (error) {
        log.error('Unexpected error when updating rule:', error);
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('rule.not_found', true);
          return res.boom.notFound(`Rule '${name}' not found`);
        }
        throw error;
      }
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Replaces an existing rule.
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
async function put(req, res) {
  return tracer.startActiveSpan('rules.put', async (span) => {
    try {
      const {
        rulePgModel = new RulePgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      const { params: { name }, body } = req;

      span.setAttribute('rule.name', name);

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
        span.setAttribute('rule.name_mismatch', true);
        return res.boom.badRequest(`Expected rule name to be '${name}', but found`
          + ` '${body.name}' in payload`);
      }

      try {
        const oldRule = await tracer.startActiveSpan('rulePgModel.get', async (dbSpan) => {
          try {
            return await rulePgModel.get(knex, { name });
          } finally {
            dbSpan.end();
          }
        });

        const oldApiRule = await translatePostgresRuleToApiRule(oldRule, knex);

        apiRule.createdAt = oldApiRule.createdAt;

        span.setAttribute('rule.type', apiRule.rule?.type);
        span.setAttribute('rule.workflow', apiRule.workflow);

        return await patchRule({ res, oldApiRule, apiRule, knex, rulePgModel });
      } catch (error) {
        log.error('Unexpected error when updating rule:', error);
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('rule.not_found', true);
          return res.boom.notFound(`Rule '${name}' not found`);
        }
        throw error;
      }
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * deletes a rule
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function del(req, res) {
  return tracer.startActiveSpan('rules.del', async (span) => {
    try {
      const {
        rulePgModel = new RulePgModel(),
        knex = await getKnexClient(),
      } = req.testContext || {};

      const name = (req.params.name || '').replace(/%20/g, ' ');

      span.setAttribute('rule.name', name);

      let rule;
      let apiRule;

      try {
        rule = await tracer.startActiveSpan('rulePgModel.get', async (dbSpan) => {
          try {
            return await rulePgModel.get(knex, { name });
          } finally {
            dbSpan.end();
          }
        });

        apiRule = await translatePostgresRuleToApiRule(rule, knex);

        span.setAttribute('rule.type', apiRule.rule?.type);
        span.setAttribute('rule.state', apiRule.state);
      } catch (error) {
        if (error instanceof RecordDoesNotExist) {
          span.setAttribute('rule.not_found', true);
          return res.boom.notFound('No record found');
        }
        throw error;
      }

      await tracer.startActiveSpan('createRejectableTransaction', async (txSpan) => {
        try {
          await createRejectableTransaction(knex, async (trx) => {
            await rulePgModel.delete(trx, { name });

            if (rule) {
              await tracer.startActiveSpan('deleteRuleResources', async (cleanupSpan) => {
                try {
                  cleanupSpan.setAttribute('rule.type', apiRule.rule?.type);
                  await deleteRuleResources(knex, apiRule);
                } finally {
                  cleanupSpan.end();
                }
              });
            }
          });
        } finally {
          txSpan.end();
        }
      });

      return res.send({ message: 'Record deleted' });
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
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
