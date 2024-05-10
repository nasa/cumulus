export type QueryStringParameters = {
  limit?: string,
  page?: string,
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
  returnFields?: string[],
  term?: { [key: string]: any },
  terms?: { [key: string]: any },
};
