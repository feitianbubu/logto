import nock from 'nock';
import { createHmac } from 'node:crypto';

import { ConnectorErrorCodes } from '@logto/connector-kit';

import createConnector from './index.js';
import {
  accountInfoPath,
  btsOrigin,
  btsTokenPath,
  mockedAccessTokenResponse,
  mockedAccountId,
  mockedAccountInfoResponse,
  mockedBtsConfig,
  mockedBtsTokenResponse,
  mockedCode,
  mockedConfig,
  mockedOpenId,
  mockedOrgUserCode,
  mockedUserInfoResponse,
  ndGatewayOrigin,
  tokenPath,
  userInfoPath,
} from './mock.js';
import { clearBtsTokenCache } from './utils.js';

const getConfig = vi.fn().mockResolvedValue(mockedConfig);

describe('getAuthorizationUri', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds a standard authorization-code uri on the uc-component hash route', async () => {
    const connector = await createConnector({ getConfig });
    const authorizationUri = await connector.getAuthorizationUri(
      {
        state: 'some_state',
        redirectUri: 'https://sso.example.com/callback',
        connectorId: 'some_connector_id',
        connectorFactoryId: 'some_connector_factory_id',
        jti: 'some_jti',
        headers: {},
      },
      vi.fn()
    );

    const url = new URL(authorizationUri);
    expect(url.origin).toEqual(mockedConfig.authorizationEndpoint);
    expect(url.hash).toEqual('#/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toEqual('code');
    expect(url.searchParams.get('client_id')).toEqual(mockedConfig.clientId);
    expect(url.searchParams.get('redirect_uri')).toEqual('https://sso.example.com/callback');
    expect(url.searchParams.get('scope')).toEqual('scope_base');
    expect(url.searchParams.get('state')).toEqual('some_state');
    expect(url.searchParams.has('sdp-app-id')).toBe(false);
  });

  it('routes mobile user agents to the uc-aq origin with the query intact', async () => {
    const connector = await createConnector({ getConfig });
    const authorizationUri = await connector.getAuthorizationUri(
      {
        state: 'some_state',
        redirectUri: 'https://sso.example.com/callback',
        connectorId: 'some_connector_id',
        connectorFactoryId: 'some_connector_factory_id',
        jti: 'some_jti',
        headers: {
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        },
      },
      vi.fn()
    );

    const url = new URL(authorizationUri);
    expect(url.origin).toEqual('https://uc-aq.sdp.101.com');
    expect(url.hash).toEqual('#/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toEqual(mockedConfig.clientId);
    expect(url.searchParams.get('redirect_uri')).toEqual('https://sso.example.com/callback');
    expect(url.searchParams.get('state')).toEqual('some_state');
  });

  it('uses the configured mobile authorization endpoint over the default', async () => {
    const connector = await createConnector({
      getConfig: vi.fn().mockResolvedValue({
        ...mockedConfig,
        mobileAuthorizationEndpoint: 'https://uc-aq.example.com',
      }),
    });
    const authorizationUri = await connector.getAuthorizationUri(
      {
        state: 'some_state',
        redirectUri: 'https://sso.example.com/callback',
        connectorId: 'some_connector_id',
        connectorFactoryId: 'some_connector_factory_id',
        jti: 'some_jti',
        headers: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36' },
      },
      vi.fn()
    );

    expect(new URL(authorizationUri).origin).toEqual('https://uc-aq.example.com');
  });

  it('keeps desktop user agents on the configured authorization endpoint', async () => {
    const connector = await createConnector({ getConfig });
    const authorizationUri = await connector.getAuthorizationUri(
      {
        state: 'some_state',
        redirectUri: 'https://sso.example.com/callback',
        connectorId: 'some_connector_id',
        connectorFactoryId: 'some_connector_factory_id',
        jti: 'some_jti',
        headers: {
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      },
      vi.fn()
    );

    expect(new URL(authorizationUri).origin).toEqual(mockedConfig.authorizationEndpoint);
  });

  it('appends `sdp-app-id` when it is configured', async () => {
    const connector = await createConnector({
      getConfig: vi.fn().mockResolvedValue({ ...mockedConfig, sdpAppId: 'mock-sdp-app-id' }),
    });
    const authorizationUri = await connector.getAuthorizationUri(
      {
        state: 'some_state',
        redirectUri: 'https://sso.example.com/callback',
        connectorId: 'some_connector_id',
        connectorFactoryId: 'some_connector_factory_id',
        jti: 'some_jti',
        headers: {},
      },
      vi.fn()
    );

    expect(new URL(authorizationUri).searchParams.get('sdp-app-id')).toEqual('mock-sdp-app-id');
  });
});

describe('getUserInfo', () => {
  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('exchanges the code and returns SocialUserInfo keyed by org_user_code', async () => {
    nock(ndGatewayOrigin).post(tokenPath).reply(200, mockedAccessTokenResponse);
    nock(ndGatewayOrigin).post(userInfoPath).reply(200, mockedUserInfoResponse);

    const connector = await createConnector({ getConfig });
    const socialUserInfo = await connector.getUserInfo({ code: mockedCode }, vi.fn());

    expect(socialUserInfo).toStrictEqual({
      id: mockedOrgUserCode,
      name: 'Zhang San',
      avatar: 'https://cdn.example.com/a.png',
      rawData: { openId: mockedOpenId, userInfo: mockedUserInfoResponse },
    });
  });

  // Without BTS configured there is no fallback; the subject must never degrade to open_id.
  it.each([
    ['missing', { ext_info: undefined }],
    ['blank', { ext_info: { org_user_code: '  ' } }],
  ])(
    'throws InvalidResponse when org_user_code is %s and BTS is not configured',
    async (_, overrides) => {
      nock(ndGatewayOrigin).post(tokenPath).reply(200, mockedAccessTokenResponse);
      nock(ndGatewayOrigin)
        .post(userInfoPath)
        .reply(200, { ...mockedUserInfoResponse, ...overrides });

      const connector = await createConnector({ getConfig });
      const promise = connector.getUserInfo({ code: mockedCode }, vi.fn());
      await expect(promise).rejects.toMatchObject({
        code: ConnectorErrorCodes.InvalidResponse,
      });
      // The UC response must be embedded: the audit log is the only place it survives.
      await expect(promise).rejects.toThrow(mockedUserInfoResponse.real_name);
    }
  );

  // A partial BTS config must be rejected up front, not discovered inside a user's sign-in.
  it('throws InvalidConfig when only part of the BTS config is set', async () => {
    const getConfig = vi
      .fn()
      .mockResolvedValue({ ...mockedConfig, btsAccount: 'mock-bts-account' });

    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ code: mockedCode }, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidConfig,
    });
  });

  // The ND gateway's WAF answers 415 to `application/x-www-form-urlencoded` on the token endpoint.
  it('posts the token request as JSON, not form-urlencoded', async () => {
    nock(ndGatewayOrigin)
      .matchHeader('content-type', 'application/json')
      .post(tokenPath, {
        client_id: mockedConfig.clientId,
        client_secret: mockedConfig.clientSecret,
        code: mockedCode,
        grant_type: 'authorization_code',
      })
      .reply(200, mockedAccessTokenResponse);
    nock(ndGatewayOrigin).post(userInfoPath).reply(200, mockedUserInfoResponse);

    const connector = await createConnector({ getConfig });

    await expect(connector.getUserInfo({ code: mockedCode }, vi.fn())).resolves.toMatchObject({
      id: mockedOrgUserCode,
    });
  });

  it('falls back to nick_name when real_name is an empty string', async () => {
    nock(ndGatewayOrigin).post(tokenPath).reply(200, mockedAccessTokenResponse);
    nock(ndGatewayOrigin)
      .post(userInfoPath)
      .reply(200, { ...mockedUserInfoResponse, real_name: '' });

    const connector = await createConnector({ getConfig });
    const socialUserInfo = await connector.getUserInfo({ code: mockedCode }, vi.fn());

    expect(socialUserInfo).toMatchObject({ name: 'zs' });
  });

  it('unwraps the double-encoded token response of the beta environment', async () => {
    nock(ndGatewayOrigin)
      .post(tokenPath)
      .reply(200, JSON.stringify(JSON.stringify(mockedAccessTokenResponse)));
    nock(ndGatewayOrigin).post(userInfoPath).reply(200, mockedUserInfoResponse);

    const connector = await createConnector({ getConfig });
    const socialUserInfo = await connector.getUserInfo({ code: mockedCode }, vi.fn());

    expect(socialUserInfo).toMatchObject({ id: mockedOrgUserCode });
  });

  // ND returns scope-dependent fields the guard does not declare; they must survive into rawData
  // for legacy-account mapping.
  it('keeps undeclared user info fields in rawData', async () => {
    nock(ndGatewayOrigin).post(tokenPath).reply(200, mockedAccessTokenResponse);
    nock(ndGatewayOrigin)
      .post(userInfoPath)
      .reply(200, { ...mockedUserInfoResponse, org_exinfo: { code: 'ND' } });

    const connector = await createConnector({ getConfig });
    const socialUserInfo = await connector.getUserInfo({ code: mockedCode }, vi.fn());

    expect(socialUserInfo.rawData).toMatchObject({
      userInfo: { org_exinfo: { code: 'ND' } },
    });
  });

  it('throws General error when the callback has no code', async () => {
    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ state: 'x' }, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.General,
    });
  });

  it('throws InvalidResponse error when the token response lacks open_id', async () => {
    nock(ndGatewayOrigin).post(tokenPath).reply(200, { access_token: 'x' });

    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ code: mockedCode }, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidResponse,
    });
  });

  it('throws SocialAccessTokenInvalid error when the ND API responds 401', async () => {
    nock(ndGatewayOrigin).post(tokenPath).reply(401, 'unauthorized');

    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ code: mockedCode }, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.SocialAccessTokenInvalid,
    });
  });
});

const mockLoginWithoutOrgUserCode = () => {
  nock(ndGatewayOrigin).post(tokenPath).reply(200, mockedAccessTokenResponse);
  nock(ndGatewayOrigin)
    .post(userInfoPath)
    .reply(200, { ...mockedUserInfoResponse, ext_info: {} });
};

describe('getUserInfo BTS account_id fallback', () => {
  const getConfig = vi.fn().mockResolvedValue(mockedBtsConfig);

  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
    clearBtsTokenCache();
  });

  // Protects the BTS contract: the token-exchange `sign`, the request MAC, the bare account_id.
  it('resolves the subject via BTS when org_user_code is missing', async () => {
    mockLoginWithoutOrgUserCode();
    nock(btsOrigin)
      .post(
        btsTokenPath,
        (body: Record<string, unknown>) =>
          body.app_name === mockedBtsConfig.btsAccount &&
          body.app_secret === 'mock******' &&
          body.sign ===
            createHmac('sha256', mockedBtsConfig.btsSecret)
              .update(`${mockedBtsConfig.btsAccount}:${String(body.timestamp)}`)
              .digest('base64')
      )
      .reply(200, mockedBtsTokenResponse);
    nock(ndGatewayOrigin)
      .matchHeader('sdp-app-id', mockedBtsConfig.btsSdpAppId)
      .matchHeader('authorization', (value) => {
        const match = /^BTS id="([^"]+)",nonce="(\d{13}:[\da-z]{8})",mac="(.+)"$/.exec(
          String(value)
        );

        if (!match || match[1] !== mockedBtsTokenResponse.access_token) {
          return false;
        }

        const expectedMac = createHmac('sha256', mockedBtsTokenResponse.mac_key)
          .update(
            [
              match[2],
              'POST',
              accountInfoPath,
              new URL(ndGatewayOrigin).host,
              mockedBtsConfig.btsSdpAppId,
              '',
            ].join('\n')
          )
          .digest('base64');

        return match[3] === expectedMac;
      })
      .post(accountInfoPath, { open_id: mockedOpenId })
      .reply(200, mockedAccountInfoResponse);

    const connector = await createConnector({ getConfig });
    const socialUserInfo = await connector.getUserInfo({ code: mockedCode }, vi.fn());

    expect(socialUserInfo).toMatchObject({ id: String(mockedAccountId) });
  });

  it('reuses the cached BTS token across sign-ins', async () => {
    const btsTokenScope = nock(btsOrigin).post(btsTokenPath).reply(200, mockedBtsTokenResponse);
    nock(ndGatewayOrigin).post(accountInfoPath).twice().reply(200, mockedAccountInfoResponse);

    const connector = await createConnector({ getConfig });

    mockLoginWithoutOrgUserCode();
    const firstSignIn = await connector.getUserInfo({ code: mockedCode }, vi.fn());
    mockLoginWithoutOrgUserCode();
    const secondSignIn = await connector.getUserInfo({ code: mockedCode }, vi.fn());

    expect(firstSignIn).toMatchObject({ id: String(mockedAccountId) });
    expect(secondSignIn).toMatchObject({ id: String(mockedAccountId) });
    // A second token request would have failed: only one interceptor is armed.
    expect(btsTokenScope.isDone()).toBe(true);
  });

  it('fails closed when BTS get_account_info fails', async () => {
    mockLoginWithoutOrgUserCode();
    nock(btsOrigin).post(btsTokenPath).reply(200, mockedBtsTokenResponse);
    nock(ndGatewayOrigin).post(accountInfoPath).reply(500, 'boom');

    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ code: mockedCode }, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.General,
    });
  });

  it('fails closed when BTS returns an empty account_id', async () => {
    mockLoginWithoutOrgUserCode();
    nock(btsOrigin).post(btsTokenPath).reply(200, mockedBtsTokenResponse);
    nock(ndGatewayOrigin)
      .post(accountInfoPath)
      .reply(200, { account_type: 'person', account_id: ' ' });

    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ code: mockedCode }, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidResponse,
    });
  });

  it('keeps using org_user_code when it is present', async () => {
    nock(ndGatewayOrigin).post(tokenPath).reply(200, mockedAccessTokenResponse);
    nock(ndGatewayOrigin).post(userInfoPath).reply(200, mockedUserInfoResponse);

    const connector = await createConnector({ getConfig });
    const socialUserInfo = await connector.getUserInfo({ code: mockedCode }, vi.fn());

    // No BTS interceptor is armed: any BTS call would have failed the test.
    expect(socialUserInfo).toMatchObject({ id: mockedOrgUserCode });
  });
});
