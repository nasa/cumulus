export type QueryStringParameters = {
  field?: string,
  fields?: string,
  infix?: string,
  limit?: string,
  page?: string,
  order?: string,
  prefix?: string,
  includeFullRecord?: string,
  sort_by?: string,
  sort_key?: string[],
  [key: string]: string | string[] | undefined,
};

export type QueryEvent = {
  queryStringParameters?: QueryStringParameters,
};

export type QueriableType = boolean | Date | number | string;

export type RangeType = {
  gte?: Omit<QueriableType, 'boolean'>,
  lte?: Omit<QueriableType, 'boolean'>,
};

export type SortType = {
  column: string,
  order?: string,
};

export type DbQueryParameters = {
  fields?: string[],
  infix?: string,
  limit?: number,
  includeFullRecord?: boolean,
  estimateTableRowCount?: boolean,
  exists?: { [key: string]: boolean },
  not?: { [key: string]: QueriableType | undefined },
  offset?: number,
  page?: number,
  prefix?: string,
  range?: { [key: string]: RangeType },
  sort?: SortType[],
  term?: { [key: string]: QueriableType | undefined },
  terms?: { [key: string]: QueriableType[] },
};
