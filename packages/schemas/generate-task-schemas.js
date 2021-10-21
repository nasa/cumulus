#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const { templateJsonSchemaWithFiles, } = require('./generate-schemas');
const taskDirectory = process.argv[2];
const command = process.argv[3];
const taskSchemasDirectory = path_1.default.join(taskDirectory, 'schemas');
if (command === 'files') {
    const schemaTemplateFiles = fs_1.default.readdirSync(taskSchemasDirectory)
        .filter((filename) => filename.endsWith('.template'));
    schemaTemplateFiles.forEach((schemaTemplateFile) => {
        templateJsonSchemaWithFiles(path_1.default.join(taskSchemasDirectory, schemaTemplateFile), path_1.default.join(taskSchemasDirectory, schemaTemplateFile.replace('.template', '')));
    });
}
//# sourceMappingURL=generate-task-schemas.js.map