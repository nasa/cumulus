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
  limit?: number,
  offset?: number,
  page?: number,
  termFields?: QueryTermField[],
  termsFields?: QueryTermsField[],
};
