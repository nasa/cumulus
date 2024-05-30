export type QueryStringParameters = {
  field?: string,
  fields?: string,
  infix?: string,
  limit?: string,
  page?: string,
  order?: string,
  prefix?: string,
  sort_by?: string,
  sort_key?: string[],
  [key: string]: string | string[] | undefined,
};

export type QueryEvent = {
  queryStringParameters?: QueryStringParameters,
};

type QueriableType = boolean | Date | number | string;

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
  offset?: number,
  page?: number,
  prefix?: string,
  range?: { [key: string]: RangeType },
  sort?: SortType[],
  term?: { [key: string]: QueriableType | undefined },
  terms?: { [key: string]: any },
};
