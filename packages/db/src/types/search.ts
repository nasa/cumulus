export type QueryStringParameters = {
  limit?: string,
  page?: string,
  [key: string]: string | string[] | undefined,
};

export type QueryEvent = {
  queryStringParameters?: QueryStringParameters,
};

export interface QueryTermField {
  name: string,
  value: any,
}

export interface QueryTermsField {
  name: string,
  value: any[],
}

export type DbQueryParameters = {
  limit?: number,
  offset?: number,
  page?: number,
  termFields?: QueryTermField[],
  termsFields?: QueryTermsField[],
};
