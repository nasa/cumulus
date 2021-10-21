"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const parse = require('json-templates');
const filesJsonSchema = require('./files.schema.json');
function templateJsonSchema(schemaTemplatePath, schemaOutputPath, replacements) {
    const schemaTemplateString = fs_1.default.readFileSync(schemaTemplatePath, 'utf-8');
    const schemaTemplate = JSON.parse(schemaTemplateString);
    const template = parse(schemaTemplate);
    const schemaOutputString = JSON.stringify(template(replacements), undefined, 2);
    fs_1.default.writeFileSync(schemaOutputPath, schemaOutputString);
}
function templateJsonSchemaWithFiles(schemaTemplatePath, schemaOutputPath) {
    templateJsonSchema(schemaTemplatePath, schemaOutputPath, { files: filesJsonSchema });
}
module.exports = {
    templateJsonSchema,
    templateJsonSchemaWithFiles,
};
//# sourceMappingURL=generate-schemas.js.map