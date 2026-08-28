import { conditional } from '@silverhand/essentials';

import {
  ConnectorError,
  ConnectorErrorCodes,
  validateConfig,
  ConnectorType,
  jsonGuard,
} from '@logto/connector-kit';
import type {
  GetAuthorizationUri,
  GetUserInfo,
  SocialConnector,
  CreateConnector,
  GetConnectorConfig,
} from '@logto/connector-kit';
import { oauth2AuthResponseGuard } from '@logto/connector-oauth';
import { HTTPError } from 'ky';

import { defaultMetadata, defaultMobileAuthorizationEndpoint, defaultScope } from './constant.js';
import { accessTokenResponseGuard, ndUcConfigGuard, userInfoResponseGuard } from './types.js';
import { getBtsAccountId, ndHttp, postNdJson } from './utils.js';

const getAuthorizationUri =
  (getConfig: GetConnectorConfig): GetAuthorizationUri =>
  async ({ state, redirectUri, scope, headers: { userAgent } }) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, ndUcConfigGuard);

    const queryParameters = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: scope ?? config.scope ?? defaultScope,
      state,
      // The uc-component page reads `sdp-app-id` from the query and toasts `sdp-app-id为空` without
      // it, even though the authorization flow itself still completes.
      ...conditional(config.sdpAppId && { 'sdp-app-id': config.sdpAppId }),
    });

    // The uc-component page forwards mobile user agents to uc-aq on its own, but drops the oauth2
    // query in the process (only `sdp-app-id` survives), stranding the sign-in on the UC fallback
    // page. Over-matching is safe here — worst case a desktop user sees the mobile login page.
    const isMobile = /mobile|android|iphone|ipad|ipod/i.test(userAgent ?? '');
    const authorizationEndpoint = isMobile
      ? (config.mobileAuthorizationEndpoint ?? defaultMobileAuthorizationEndpoint)
      : config.authorizationEndpoint;

    // The UC pages are hash-routed: query goes in the `?` segment, the authorize route in
    // `#/oauth2/authorize`.
    return new URL(
      `?${queryParameters.toString()}#/oauth2/authorize`,
      authorizationEndpoint
    ).toString();
  };

const getUserInfo =
  (getConfig: GetConnectorConfig): GetUserInfo =>
  async (data) => {
    const parsedAuthResponse = oauth2AuthResponseGuard.safeParse(data);

    if (!parsedAuthResponse.success) {
      throw new ConnectorError(ConnectorErrorCodes.General, JSON.stringify(data));
    }

    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, ndUcConfigGuard);

    const ndApi = ndHttp.extend({
      headers: conditional(config.sdpAppId && { 'sdp-app-id': config.sdpAppId }),
    });

    try {
      const {
        data: { access_token: accessToken, open_id: openId },
      } = await postNdJson(
        ndApi,
        config.tokenEndpoint,
        {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: parsedAuthResponse.data.code,
          grant_type: 'authorization_code',
        },
        accessTokenResponseGuard
      );

      const { data: userInfo, raw: rawUserInfo } = await postNdJson(
        ndApi,
        config.userInfoEndpoint,
        { open_id: openId, access_token: accessToken },
        userInfoResponseGuard
      );

      // The subject must be an employee code: it is what clinx stores as oidc_id, and unlike the
      // per-app open_id it survives a UC client re-registration. Never fall back to open_id.
      const orgUserCode = conditional(userInfo.ext_info?.org_user_code?.trim());
      const subject = orgUserCode ?? (await getBtsAccountId(config, openId, rawUserInfo));

      return {
        id: subject,
        // ND often returns empty strings rather than absent fields, so fall through empty values.
        name:
          conditional(userInfo.real_name?.trim()) ??
          conditional(userInfo.nick_name?.trim()) ??
          subject,
        avatar: conditional(userInfo.avatar_url?.trim()),
        // The subject is the employee code, so keep open_id (and scope-dependent extras)
        // retrievable via rawData.
        rawData: jsonGuard.parse({ openId, userInfo: rawUserInfo }),
      };
    } catch (error: unknown) {
      if (error instanceof HTTPError) {
        const { status } = error.response;

        throw new ConnectorError(
          status === 401
            ? ConnectorErrorCodes.SocialAccessTokenInvalid
            : ConnectorErrorCodes.General,
          `ND UC API request failed: ${status} ${await error.response.text()}`
        );
      }

      throw error;
    }
  };

const createNdUcConnector: CreateConnector<SocialConnector> = async ({ getConfig }) => {
  return {
    metadata: defaultMetadata,
    type: ConnectorType.Social,
    configGuard: ndUcConfigGuard,
    getAuthorizationUri: getAuthorizationUri(getConfig),
    getUserInfo: getUserInfo(getConfig),
  };
};

export default createNdUcConnector;
