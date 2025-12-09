//@ts-check

'use strict';

const router = require('express-promise-router')();
const get = require('lodash/get');
const { StatsSearch } = require('@cumulus/db');
const omit = require('lodash/omit');

// Import OpenTelemetry
const { trace } = require('@opentelemetry/api');

// Get the tracer
const tracer = trace.getTracer('cumulus-api-stats');

/**
 * Map requested stats types to supported types
 *
 * @param {object} req - express request object
 * @returns {string|undefined} returns the type of stats
 */
function getType(req) {
  const supportedTypes = {
    granules: 'granule',
    pdrs: 'pdr',
    collections: 'collection',
    logs: 'logs',
    providers: 'provider',
    executions: 'execution',
    reconciliationReports: 'reconciliationReport',
  };

  const typeRequested = get(req, 'params.type') || get(req, 'query.type');
  const type = get(supportedTypes, typeRequested);

  return type;
}

/**
 * get summary stats
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function summary(req, res) {
  return tracer.startActiveSpan('stats.summary', async (span) => {
    try {
      const params = req.query;

      const now = Date.now();
      const timestampFrom = Number.parseInt(get(
        params,
        'timestamp__from',
        now - 24 * 3600 * 1000
      ), 10);
      const timestampTo = Number.parseInt(get(params, 'timestamp__to', now), 10);

      params.timestamp__from = timestampFrom;
      params.timestamp__to = timestampTo;

      const timeRangeHours = (timestampTo - timestampFrom) / (3600 * 1000);

      span.setAttribute('stats.operation', 'summary');
      span.setAttribute('stats.type', 'granule');
      span.setAttribute('stats.timestamp_from', new Date(timestampFrom).toISOString());
      span.setAttribute('stats.timestamp_to', new Date(timestampTo).toISOString());
      span.setAttribute('stats.time_range_hours', timeRangeHours);
      span.setAttribute('stats.has_query_params', Object.keys(params).length > 2); // More than just timestamp params

      const stats = new StatsSearch({ queryStringParameters: params }, 'granule');
      const r = await stats.summary();

      // Add result metrics to span
      span.setAttribute('stats.result_errors', r.errors?.value || 0);
      span.setAttribute('stats.result_granules', r.granules?.value || 0);
      span.setAttribute('stats.result_collections', r.collections?.value || 0);
      span.setAttribute('stats.result_avg_processing_time', r.processingTime?.value || 0);

      return res.send(r);
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
 * get aggregate stats
 *
 * @param {object} req - express request object
 * @param {object} res - express response object
 * @returns {Promise<object>} the promise of express response object
 */
async function aggregate(req, res) {
  return tracer.startActiveSpan('stats.aggregate', async (span) => {
    try {
      const typeRequested = get(req, 'params.type') || get(req, 'query.type');
      const type = getType(req);

      span.setAttribute('stats.operation', 'aggregate');
      span.setAttribute('stats.type_requested', typeRequested);
      span.setAttribute('stats.type', type || 'unknown');
      span.setAttribute('stats.field', req.query.field || 'status');
      span.setAttribute('stats.has_query_params', Object.keys(omit(req.query, 'type')).length > 0);

      if (type) {
        const stats = new StatsSearch({ queryStringParameters: omit(req.query, 'type') }, type);
        const r = await stats.aggregate();

        // Add result metrics to span
        span.setAttribute('stats.result_count', r.meta?.count || 0);
        span.setAttribute('stats.result_unique_values', r.count?.length || 0);

        return res.send(r);
      }

      span.setAttribute('stats.missing_type', true);
      return res.boom.badRequest('Type must be included in Stats Aggregate query string parameters');
    } catch (error) {
      span.recordException(error);
      span.setAttribute('error', true);
      throw error;
    } finally {
      span.end();
    }
  });
}

router.get('/aggregate/:type?', aggregate);
router.get('/', summary);

module.exports = router;
