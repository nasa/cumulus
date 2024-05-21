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
