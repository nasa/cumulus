import Base from './base';
import { tableNames } from '../tables';

export default class FileModel extends Base {
  constructor() {
    super({
      tableName: tableNames.files,
    });
  }
}
