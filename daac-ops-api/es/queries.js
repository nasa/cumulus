/* This code is copied from sat-api-lib library
 * with some alterations.
 * source: https://raw.githubusercontent.com/sat-utils/sat-api-lib/master/libs/queries.js
 */

'use strict';

const omit = require('lodash.omit');

const regexes = {
  terms: /^(.*)__in$/,
  term: /^((?!__).)*$/,
  not: /^(.*)__not$/,
  exists: /^(.*)__exists$/,
  range: /^(.*)__(from|to)$/
};

const build = {
  general: params => ({
    query_string: {
      query: params.q
    }
  }),

  prefix: (queries, _prefix, terms) => {
    if (_prefix) {
      let fields = [
        'granuleId',
        'status',
        'pdrName',
        'collectionName',
        'userName',
        'providerName',
        'name',
        'error'
      ];

      terms = terms.map(f => f.name);

      // remove fields that are included in the termFields
      fields = fields.filter((field) => {
        if (terms.indexOf(field) === -1) {
          return true;
        }
        return false;
      });

      const results = fields.map(f => ({
        prefix: {
          [`${f}.keyword`]: _prefix
        }
      }));

      queries.should = queries.should.concat(results);
      queries.minimum_should_match = 1;
    }
  },

  _term: (params, regex) => params.map((i) => {
    let fieldName = i.name;

    if (regex) {
      const match = i.name.match(regex);
      fieldName = match[1];
    }

    // check for boolean values
    if (typeof i.value === 'number') {
      i.value = Boolean(i.value);
    }

    if (typeof i.value === 'string') {
      const boolCheck = i.value.toLowerCase();
      if (boolCheck !== 'true' && boolCheck !== 'false') {
        fieldName = `${fieldName}.keyword`;
      }
    }

    return {
      term: {
        [fieldName]: i.value
      }
    };
  }),

  term: (queries, params) => {
    queries.must = queries.must.concat(build._term(params));
  },

  range: (queries, params, regex) => {
    const fields = {};

    // extract field names and values
    params.forEach((i) => {
      const match = i.name.match(regex);
      if (!fields[match[1]]) fields[match[1]] = {};

      if (match[2] === 'from') {
        fields[match[1]].gte = i.value;
      }

      if (match[2] === 'to') {
        fields[match[1]].lte = i.value;
      }
    });

    // because elasticsearch doesn't support multiple
    // fields in range query, make it an erray
    const results = Object.keys(fields).map(k => ({
      range: { [k]: fields[k] } }
    ));

    queries.must = queries.must.concat(results);
  },

  terms: (queries, params, regex) => {
    const results = params.map((i) => {
      const field = i.name.match(regex)[1];
      return {
        terms: {
          [field]: i.value.replace(' ', '').split(',')
        }
      };
    });

    queries.must = queries.must.concat(results);
  },

  not: (queries, params, regex) => {
    const results = params.map((i) => {
      const field = i.name.match(regex)[1];
      return {
        terms: {
          [field]: i.value.replace(' ', '').split(',')
        }
      };
    });

    queries.must_not = queries.must_not.concat(results);
  },

  exists: (queries, params, regex) => {
    const results = params.map((i) => {
      const field = i.name.match(regex)[1];
      return {
        exists: {
          field: field
        }
      };
    });

    queries.must = queries.must.concat(results);
  }
};

function selectParams(fields, regex) {
  return fields.filter((f) => {
    const match = f.name.match(regex);
    if (match) return true;
    return false;
  });
}

export default function(params) {
  const sortBy = params.sort_by || 'timestamp';
  const order = params.order || 'desc';

  const response = {
    query: { match_all: {} },
    sort: [
      { [sortBy]: { order: order } }
    ]
  };

  const queries = {
    must: [],
    should: [],
    must_not: []
  };

  const _prefix = params.prefix;

  // remove reserved words (that are not fields)
  params = omit(
    params,
    [
      'limit',
      'page',
      'skip',
      'sort_by',
      'order',
      'prefix',
      'type',
      'interval',
      'format',
      'field',
      'fields'
    ]
  );

  if (Object.keys(params).length === 0 && !_prefix) {
    return response;
  }

  // Do general search
  if (params.q) {
    response.query = build.general(params);
    return response;
  }

  // determine which search strategy should be applied
  // options are term, terms, range, exists and not in
  const fields = Object.keys(params).map(k => ({ name: k, value: params[k] }));

  Object.keys(regexes).forEach((k) => {
    const f = selectParams(fields, regexes[k]);

    if (f) {
      build[k](queries, f, regexes[k]);
    }
  });

  // perform prefix search
  build.prefix(queries, _prefix, fields);

  response.query = {
    bool: queries
  };

  return response;
}
