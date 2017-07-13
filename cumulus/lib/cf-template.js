const yaml = require('js-yaml');
const deepAssign = require('deep-assign');

const ignoredType = (name, kind) => {
  const T = function IgnoredType(val) {
    this.val = val;
  };

  return new yaml.Type(`!${name}`, {
    kind: kind,
    construct: (data) => new T(data),
    instanceOf: T,
    represent: (data) => data.val
  });
};

const ignoredTypes = [];
const ignoredTypeNames = [
  'Base64', 'And', 'Equals', 'If', 'Not',
  'Equals', 'Or', 'FindInMap', 'GetAtt',
  'GetAZs', 'ImportValue', 'Join', 'Select',
  'Split', 'Sub', 'Ref'
];

for (const name of ignoredTypeNames) {
  ignoredTypes.push(ignoredType(name, 'scalar'));
  ignoredTypes.push(ignoredType(name, 'mapping'));
  ignoredTypes.push(ignoredType(name, 'sequence'));
}

const buildSchema = (prefix = '', context = {}) => {
  const types = [
    new yaml.Type('!Var', {
      kind: 'scalar',
      construct: (data) => context[data]
    }),
    new yaml.Type('!ResourceName', {
      kind: 'scalar',
      construct: (data) => prefix + data
    })
  ];
  return yaml.Schema.create(types.concat(ignoredTypes));
};

const prefixResources = (template, prefix) => {
  const unprefixed = template.Resources;
  const prefixed = { };
  for (const key of Object.keys(template.Resources)) {
    prefixed[prefix + key] = unprefixed[key];
  }
  return Object.assign({}, template, { Resources: prefixed });
};

const parseTemplate = (templateStr, prefix, context) =>
  prefixResources(
    yaml.safeLoad(templateStr, { schema: buildSchema(prefix, context) }),
    prefix
  );

const dumpTemplate = (template) =>
  yaml.safeDump(template, { schema: buildSchema() })
      .replace(/!<!([^>]+)>/g, '!$1');

const mergeTemplates = (templates) => deepAssign(...templates);

module.exports = {
  parseTemplate: parseTemplate,
  dumpTemplate: dumpTemplate,
  mergeTemplates: mergeTemplates
};
