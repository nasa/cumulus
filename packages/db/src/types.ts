export interface envConectionConfigObject extends NodeJS.ProcessEnv {
  PG_PASSWORD: string,
  PG_HOST: string,
  PG_USER: string,
  PG_DATABASE?: string,
}

export interface knexSecretConnectionConfigObject extends NodeJS.ProcessEnv {
  databaseCredentialSecretArn: string
}
