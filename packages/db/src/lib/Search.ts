import { BasePgModel } from '../models/base';

class Search {
  readonly pgModel: typeof BasePgModel;
  readonly offset: number;

  constructor({
    pgModel,
  }: {
    pgModel: typeof BasePgModel,
  }) {
    this.pgModel = pgModel;
    this.offset = 0;
  }
}

export { Search };
