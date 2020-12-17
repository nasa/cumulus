import BaseModel from './base';
import { tableNames } from '../tables';

export default class FileModel extends BaseModel {
  constructor() {
    super({
      tableName: tableNames.files,
    });
  }
}
