export type QueryStringParameters = {
  limit?: string,
  page?: string,
  [key: string]: string | string[] | undefined,
};

export type QueryEvent = {
  queryStringParameters?: QueryStringParameters,
};

export type QueryTermField = {
  name: string,
  value: any,
};

export type QueryTermsField = {
  name: string,
  value: any[],
};

export type DbQueryParameters = {
  infix?: string,
  limit?: number,
  offset?: number,
  page?: number,
  prefix?: string,
  q?: string,
  returnFields?: string[],
  termFields?: QueryTermField[],
  termsFields?: QueryTermsField[],
};
