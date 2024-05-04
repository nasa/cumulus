export interface QueryStringParameters {
  limit?: string,
  page?: string,
  [key: string]: string | string[] | undefined,
}

export interface QueryEvent {
  queryStringParameters?: QueryStringParameters,
}

export interface QueryTermField {
  name: string,
  value: any,
}

export interface QueryTermsField {
  name: string,
  value: any[],
}

export interface DbQueryParameters {
  limit?: number,
  offset?: number,
  page?: number,
  termFields?: QueryTermField[],
  termsFields?: QueryTermsField[],
}
