import { conditional } from '@silverhand/essentials';
import type { ZodType, z } from 'zod';

import {
  ConnectorError,
  ConnectorErrorCodes,
  validateConfig,
  ConnectorType,
  jsonGuard,
  parseJson,
} from '@logto/connector-kit';
import type {
  GetAuthorizationUri,
  GetUserInfo,
  SocialConnector,
  CreateConnector,
  GetConnectorConfig,
} from '@logto/connector-kit';
import { oauth2AuthResponseGuard } from '@logto/connector-oauth';
import ky, { HTTPError } from 'ky';
import type { KyInstance } from 'ky';

import { defaultMetadata, defaultScope, defaultTimeout } from './constant.js';
import { accessTokenResponseGuard, ndUcConfigGuard, userInfoResponseGuard } from './types.js';

const getAuthorizationUri =
  (getConfig: GetConnectorConfig): GetAuthorizationUri =>
  async ({ state, redirectUri, scope }) => {
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

    // The uc-component page is hash-routed: query goes in the `?` segment, the authorize route in
    // `#/oauth2/authorize`.
    return new URL(
      `?${queryParameters.toString()}#/oauth2/authorize`,
      config.authorizationEndpoint
    ).toString();
  };

/**
 * Unlike standard OAuth2, the ND gateway's WAF rejects `application/x-www-form-urlencoded` with
 * 415 WAF/UNSUPPORTED_MEDIA_TYPE, so every call posts JSON.
 *
 * Returns the unvalidated body alongside the parsed one: ND adds scope-dependent fields that the
 * guards do not declare, and those have to survive into `rawData`.
 */
const postNdJson = async <T extends ZodType<unknown>>(
  ndApi: KyInstance,
  url: string,
  json: Record<string, string>,
  guard: T
): Promise<{ data: z.infer<T>; raw: unknown }> => {
  const parsed = parseJson(await ndApi.post(url, { json }).text());
  // The beta environment double-encodes the body as a JSON string; unwrap one level.
  const raw = typeof parsed === 'string' ? parseJson(parsed) : parsed;
  const result = guard.safeParse(raw);

  if (!result.success) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, result.error);
  }

  return { data: result.data, raw };
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

    // The ND gateway returns 406 for ky's default `Accept: text/*`, so request JSON explicitly.
    const ndApi = ky.extend({
      headers: {
        accept: 'application/json',
        ...conditional(config.sdpAppId && { 'sdp-app-id': config.sdpAppId }),
      },
      timeout: defaultTimeout,
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

      // The subject must be the employee code: it is what clinx stores as oidc_id, and unlike the
      // per-app open_id it survives a UC client re-registration. Fail closed — falling back to
      // open_id would mix two key spaces in the identity store.
      const orgUserCode = conditional(userInfo.ext_info?.org_user_code?.trim());

      if (!orgUserCode) {
        // The full response is embedded so the audit log shows what UC returns for accounts
        // without an employee code (e.g. outsourced staff) — the failure path stores it nowhere else.
        throw new ConnectorError(
          ConnectorErrorCodes.InvalidResponse,
          `missing ext_info.org_user_code: only org accounts with an employee code are supported; user info: ${JSON.stringify(rawUserInfo)}`
        );
      }

      return {
        id: orgUserCode,
        // ND often returns empty strings rather than absent fields, so fall through empty values.
        name:
          conditional(userInfo.real_name?.trim()) ??
          conditional(userInfo.nick_name?.trim()) ??
          orgUserCode,
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
