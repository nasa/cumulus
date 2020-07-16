export interface LaunchpadTokenParams {
  api: string
  passphrase: string
  certificate: string
}

export interface TokenResponse {
  session_maxtimeout: number
  status: string
}

export interface GetTokenResponse extends TokenResponse {
  sm_token: string
}

export interface TokenObject extends GetTokenResponse {
  session_starttime: number
}

export interface ValidateTokenResponse extends TokenResponse {
  session_starttime: number
  owner_auid: string
  owner_groups: string[]
}

export interface ValidateTokenResult extends Partial<Omit<ValidateTokenResponse, 'owner_groups'>> {
  status: string
  message?: string
}
