import { assert, conditional } from '@silverhand/essentials';
import { createHmac, randomBytes } from 'node:crypto';
import type { ZodType, z } from 'zod';

import { ConnectorError, ConnectorErrorCodes, parseJson } from '@logto/connector-kit';
import ky, { HTTPError } from 'ky';
import type { KyInstance } from 'ky';

import { defaultAccountInfoEndpoint, defaultBtsTokenUrl, defaultTimeout } from './constant.js';
import type { NdUcConfig } from './types.js';
import { accountInfoResponseGuard, btsTokenResponseGuard } from './types.js';

// The ND gateway returns 406 for ky's default `Accept: text/*`, so request JSON explicitly.
export const ndHttp = ky.extend({
  headers: { accept: 'application/json' },
  timeout: defaultTimeout,
});

/**
 * Unlike standard OAuth2, the ND gateway's WAF rejects `application/x-www-form-urlencoded` with
 * 415 WAF/UNSUPPORTED_MEDIA_TYPE, so every call posts JSON.
 *
 * Returns the unvalidated body alongside the parsed one: ND adds scope-dependent fields that the
 * guards do not declare, and those have to survive into `rawData`.
 */
export const postNdJson = async <T extends ZodType<unknown>>(
  ndApi: KyInstance,
  url: string,
  json: Record<string, unknown>,
  guard: T
): Promise<{ data: z.infer<T>; raw: unknown }> => {
  const body = await ndApi.post(url, { json }).text();
  // Errors carry the endpoint and a body snippet: a 200 with a non-JSON body (proxy or gateway
  // placeholder page, wrong URL) is otherwise indistinguishable across the calls in one sign-in.
  const invalidBody = `non-JSON response from ${url}: ${body.slice(0, 200)}`;
  const parsed = parseJson(body, ConnectorErrorCodes.InvalidResponse, invalidBody);
  // The beta environment double-encodes the body as a JSON string; unwrap one level.
  const raw =
    typeof parsed === 'string'
      ? parseJson(parsed, ConnectorErrorCodes.InvalidResponse, invalidBody)
      : parsed;
  const result = guard.safeParse(raw);

  if (!result.success) {
    throw new ConnectorError(ConnectorErrorCodes.InvalidResponse, {
      url,
      issues: result.error.issues,
    });
  }

  return { data: result.data, raw };
};

const hmacSha256Base64 = (key: string, message: string) =>
  createHmac('sha256', key).update(message).digest('base64');

type BtsCredentials = { account: string; secret: string; tokenUrl: string };

type BtsToken = { accessToken: string; macKey: string; expiresAt: number };

// BTS tokens live 48 hours; refresh at half-life so a cached token is never used near expiry.
const btsTokenTtl = 24 * 60 * 60 * 1000;
const btsTokenCache = new Map<string, BtsToken>();

// The secret is part of the key so a rotated secret cannot keep serving the stale token.
const btsCacheKey = ({ account, secret, tokenUrl }: BtsCredentials) =>
  `${tokenUrl}#${account}#${secret}`;

export const clearBtsTokenCache = () => {
  btsTokenCache.clear();
};

const getBtsToken = async (credentials: BtsCredentials): Promise<BtsToken> => {
  const cacheKey = btsCacheKey(credentials);
  const cached = btsTokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const { account, secret, tokenUrl } = credentials;
  const timestamp = Date.now();
  const { data } = await postNdJson(
    ndHttp,
    tokenUrl,
    {
      app_name: account,
      // `token_type`/`environment` are fixed protocol values, not debug leftovers; the endpoint
      // authenticates via `sign`, and `app_secret` is masked by protocol design.
      app_secret: `${secret.slice(0, 4)}******`,
      token_type: 'e',
      timestamp,
      sign: hmacSha256Base64(secret, `${account}:${timestamp}`),
      environment: 'localhost',
    },
    btsTokenResponseGuard
  );

  const token = {
    accessToken: data.access_token,
    macKey: data.mac_key,
    expiresAt: timestamp + btsTokenTtl,
  };
  btsTokenCache.set(cacheKey, token);

  return token;
};

const nonceCharset = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Exchanges an open_id for the BTS account_id. account_id and org_user_code share the
 * employee-code namespace (a person account's account_id is its HR employee code), so the caller
 * can use it as the connector subject as-is, without a prefix.
 */
export const getBtsAccountId = async (
  config: NdUcConfig,
  openId: string,
  rawUserInfo: unknown
): Promise<string> => {
  const { btsAccount, btsSecret, btsSdpAppId } = config;

  // The full UC response is embedded so the audit log shows what UC returns for accounts without
  // an employee code (e.g. outsourced staff) — the failure path stores it nowhere else.
  assert(
    btsAccount && btsSecret && btsSdpAppId,
    new ConnectorError(
      ConnectorErrorCodes.InvalidResponse,
      `missing ext_info.org_user_code, and the BTS account_id fallback is not configured (btsAccount / btsSecret / btsSdpAppId); user info: ${JSON.stringify(rawUserInfo)}`
    )
  );

  const credentials = {
    account: btsAccount,
    secret: btsSecret,
    tokenUrl: config.btsTokenUrl ?? defaultBtsTokenUrl,
  };
  const endpoint = config.accountInfoEndpoint ?? defaultAccountInfoEndpoint;

  try {
    const { accessToken, macKey } = await getBtsToken(credentials);

    const { pathname, search, host } = new URL(endpoint);
    const nonce = `${Date.now()}:${Array.from(randomBytes(8), (byte) =>
      nonceCharset.charAt(byte % nonceCharset.length)
    ).join('')}`;
    // The BTS-mode MAC signs nonce, method, path+query and host, then the values of the `SDP-`
    // headers sorted by uppercased key (only `sdp-app-id` here), and a trailing empty line.
    const signString = [nonce, 'POST', `${pathname}${search}`, host, btsSdpAppId, ''].join('\n');

    const { data } = await postNdJson(
      ndHttp.extend({
        headers: {
          'sdp-app-id': btsSdpAppId,
          authorization: `BTS id="${accessToken}",nonce="${nonce}",mac="${hmacSha256Base64(macKey, signString)}"`,
        },
      }),
      endpoint,
      { open_id: openId },
      accountInfoResponseGuard
    );

    const accountId = conditional(String(data.account_id).trim());
    assert(
      accountId,
      new ConnectorError(
        ConnectorErrorCodes.InvalidResponse,
        'BTS get_account_info returned an empty account_id'
      )
    );

    return accountId;
  } catch (error: unknown) {
    if (error instanceof HTTPError) {
      // Drop the cached token so a revoked token cannot wedge the fallback until the TTL passes.
      btsTokenCache.delete(btsCacheKey(credentials));

      throw new ConnectorError(
        ConnectorErrorCodes.General,
        `BTS request failed: ${error.response.status} ${await error.response.text()}`
      );
    }

    throw error;
  }
};
