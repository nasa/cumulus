export type QueryStringParameters = {
  limit?: string,
  page?: string,
  [key: string]: string | string[] | undefined,
};

export type QueryEvent = {
  queryStringParameters?: QueryStringParameters,
};

export type DbQueryParameters = {
  limit?: number,
  offset?: number,
  page?: number,
};
