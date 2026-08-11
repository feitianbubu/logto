export const ndGatewayOrigin = 'https://uc-gateway.example.com';

export const tokenPath = '/v1.1/oauth2/access_token';

export const userInfoPath = '/v1.1/oauth2/get_user_info';

export const mockedConfig = {
  clientId: '<client-id>',
  clientSecret: '<client-secret>',
  authorizationEndpoint: 'https://uc-component.example.com',
  tokenEndpoint: `${ndGatewayOrigin}${tokenPath}`,
  userInfoEndpoint: `${ndGatewayOrigin}${userInfoPath}`,
  scope: 'scope_base',
};

export const mockedCode = 'mock-auth-code';

export const mockedOpenId = 'mock-open-id';

export const mockedOrgUserCode = 'E12345';

export const mockedAccessTokenResponse = {
  access_token: 'mock-access-token',
  open_id: mockedOpenId,
  expires_at: '2026-08-11T18:37:00.568+0800',
  refresh_token: 'mock-refresh-token',
};

export const mockedUserInfoResponse = {
  open_id: mockedOpenId,
  nick_name: 'zs',
  avatar_url: 'https://cdn.example.com/a.png',
  gender: 'male',
  real_name: 'Zhang San',
  ext_info: { org_user_code: mockedOrgUserCode },
};

export const btsOrigin = 'https://ucbts.example.com';

export const btsTokenPath = '/v1/tokens';

export const accountInfoPath = '/v1.1/idp/get_account_info';

export const mockedBtsConfig = {
  ...mockedConfig,
  btsAccount: 'mock-bts-account',
  btsSecret: 'mock-bts-secret',
  btsSdpAppId: 'mock-bts-sdp-app-id',
  btsTokenUrl: `${btsOrigin}${btsTokenPath}`,
  accountInfoEndpoint: `${ndGatewayOrigin}${accountInfoPath}`,
};

export const mockedBtsTokenResponse = {
  access_token: 'mock-bts-access-token',
  mac_key: 'mock-bts-mac-key',
};

export const mockedAccountId = 930_314;

export const mockedAccountInfoResponse = {
  account_type: 'person',
  account_id: mockedAccountId,
};
