import pRetry from 'p-retry';

export type HttpMethod = 'DELETE' | 'GET' | 'POST' | 'PUT' | 'PATCH';

// https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
export interface ApiGatewayLambdaProxyPayload {
  resource: '/{proxy+}',
  httpMethod: HttpMethod,
  path: string,
  headers?: { [key: string]: string | undefined },
  queryStringParameters?: { [key: string]: string | string[] | undefined }
  body?: string
}

export interface ApiGatewayLambdaHttpProxyResponse {
  statusCode: number,
  headers: { [key: string]: string },
  body: string,
  isBase64Encoded: boolean
}

export interface ApiGatewayLambdaErrorResponse {
  errorMessage: string,
  errorType: string,
  trace: string[]
}

export interface InvokeApiFunctionParams {
  prefix: string,
  payload: ApiGatewayLambdaProxyPayload,
  pRetryOptions?: pRetry.Options,
  expectedStatusCodes?: number | number[]
}

export type InvokeApiFunction = (
  params: InvokeApiFunctionParams
) => Promise<ApiGatewayLambdaHttpProxyResponse>;
