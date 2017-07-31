'use strict';


/**
 * Takes in the name of a schema in the schemas directory and merges in any references other
 * definitions.
 */

var fs = require('fs');

/**
 * Does a shallow clone of the map
 */
function clone(m) {
  return Object.assign({}, m);
}

var fileNamesToSchemas = {};

/**
 * Loads a JSON schema into a JavaScript object.
 */
function loadSchema(fileName) {
  if (fileNamesToSchemas[fileName]) {
    return fileNamesToSchemas[fileName];
  }
  var schema = JSON.parse(fs.readFileSync('schemas/' + fileName));
  fileNamesToSchemas[fileName] = schema;
  return schema;
}

/**
 * Resolves a reference like "ingest_common_schema.json#/definitions/WorkflowConfigTemplateType"
 * into a tuple of the definitions map for that referenced type and the new ref.
 */
function resolveRef(ref) {
  var parts = ref.split('#/definitions/');
  if (parts.length > 1 && parts[0] !== '') {
    var fileName = parts[0],
        typeName = parts[1];

    var schema = loadSchema(fileName);
    var type = schema.definitions[typeName];
    var newDefinitions = {};
    newDefinitions[typeName] = type;
    return [newDefinitions, '#/definitions/' + typeName];
  }
  return [null, ref];
}

/**
 * Recursively replaces all $refs with local references.
 * Returns a tuple of new definitions to merge into the top level schema and the updated schema.
 */
function resolveRefs(schemaElement) {
  if (schemaElement.constructor === Object) {
    var updatedSchemaElement = clone(schemaElement);
    var newDefinitions = {};

    if (schemaElement['$ref']) {
      var _resolveRef = resolveRef(schemaElement['$ref']),
          defs = _resolveRef[0],
          ref = _resolveRef[1];

      updatedSchemaElement['$ref'] = ref;
      newDefinitions = clone(defs);
    }

    var updatedSchemaElement2 = {};

    for (var prop in updatedSchemaElement) {
      var internalEl = updatedSchemaElement[prop];
      var _resolveRefs = resolveRefs(internalEl),
          defs = _resolveRefs[0],
          updatedEl = _resolveRefs[1];

      newDefinitions = Object.assign({}, newDefinitions, defs);
      updatedSchemaElement2[prop] = updatedEl;
    }

    return [newDefinitions, updatedSchemaElement2];
  }
  return [null, schemaElement];
}


/**
 * Performs the resolution and merging of referenced schemas from the schema.
 */
function createMergedSchema(schema) {
  var _resolveRefs = resolveRefs(schema),
      defs = _resolveRefs[0],
      updatedSchema = _resolveRefs[1];
  updatedSchema.definitions = Object.assign({}, updatedSchema.definitions, defs);
  return updatedSchema;
}

function main(schemaName) {
  var s = loadSchema(schemaName);
  var mergedSchema = createMergedSchema(s);
  fs.writeFileSync("schemas/merged-" + schemaName, JSON.stringify(mergedSchema, null, 2));
}

main(process.argv[process.argv.length - 1]);