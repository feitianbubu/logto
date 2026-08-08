import nock from 'nock';

import { ConnectorErrorCodes } from '@logto/connector-kit';

import createConnector from './index.js';
import {
  mockedAccessTokenResponse,
  mockedCode,
  mockedConfig,
  mockedOpenId,
  mockedOrgUserCode,
  mockedUserInfoResponse,
  ndGatewayOrigin,
  tokenPath,
  userInfoPath,
} from './mock.js';

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

  // The subject must never fall back to open_id: it has to match the oidc_id clinx stores.
  it.each([
    ['missing', { ext_info: undefined }],
    ['blank', { ext_info: { org_user_code: '  ' } }],
  ])('throws InvalidResponse when ext_info.org_user_code is %s', async (_, overrides) => {
    nock(ndGatewayOrigin).post(tokenPath).reply(200, mockedAccessTokenResponse);
    nock(ndGatewayOrigin)
      .post(userInfoPath)
      .reply(200, { ...mockedUserInfoResponse, ...overrides });

    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ code: mockedCode }, vi.fn())).rejects.toMatchObject({
      code: ConnectorErrorCodes.InvalidResponse,
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
