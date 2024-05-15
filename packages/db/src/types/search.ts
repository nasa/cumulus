export type QueryStringParameters = {
  fields?: string,
  infix?: string,
  limit?: string,
  page?: string,
  order?: string,
  prefix?: string,
  sort_by?: string,
  sort_key?: string,
  type?: string,
  field?: string,
  provider?: string,
  collectionId?: string,
  timestamp__to?: string,
  timestamp__from?: string,
  [key: string]: string | string[] | undefined,
};

export type QueryEvent = {
  queryStringParameters?: QueryStringParameters,
};

export type DbQueryParameters = {
  infix?: string,
  limit?: number,
  offset?: number,
  page?: number,
  prefix?: string,
  fields?: string[],
  term?: { [key: string]: any },
  terms?: { [key: string]: any },
};
