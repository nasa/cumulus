import { compile } from 'json-schema-to-typescript';
import { upperFirst, camelCase } from 'lodash';
import fs from 'fs/promises';
import path from 'path';

import type { FileHandle } from 'fs/promises';
import type { JSONSchema } from 'json-schema-to-typescript';

const BANNER_COMMENT = `
/**
 * This file is generated using @cumulus/schema. Any modifications made to this file
 * will the overwritten when the build script is rerun. Please do not modify this file.
 */
`

async function generateTypeFromFile(path: string, bannerComment: string): Promise<string> {
  const rawSchema = await fs.readFile(path, { encoding: 'utf-8' });
  const jsonSchema = JSON.parse(rawSchema) as JSONSchema;
  if (!jsonSchema.title) {
    throw new Error(`Must have a title defined in the JSONSchema defined in ${path}.`);
  }
  return await compile(
    jsonSchema, 
    upperFirst(camelCase(jsonSchema.title!)), 
    { 
      additionalProperties: false,
      bannerComment,
    }
  )
}

export default async function generateTypes(folderPath: string, outputFile: FileHandle): Promise<void> {
  const schemaFiles = await fs.readdir(folderPath)
  const types = await Promise.all(
    schemaFiles.filter(file => /^\w+\.json$/.test(file))
      .map(
        (filePath, idx) => generateTypeFromFile(
          path.join(folderPath, filePath), 
          idx === 0 ? BANNER_COMMENT : ''
        )
      )
  )
  await fs.writeFile(outputFile, types.join('\n'))
}