import { z } from 'zod';

import { oauth2ConfigGuard } from '@logto/connector-oauth';

export const ndUcConfigGuard = oauth2ConfigGuard
  .pick({
    clientId: true,
    clientSecret: true,
    authorizationEndpoint: true,
    tokenEndpoint: true,
    scope: true,
  })
  .extend({
    userInfoEndpoint: z.string(),
    /**
     * ND application id, passed as the `sdp-app-id` query parameter to the authorization page and
     * as the `sdp-app-id` header to the UC gateway. Optional: the flow completes without it, but
     * the authorization page warns `sdp-app-id为空`.
     */
    sdpAppId: z.string().optional(),
    /**
     * BTS credentials for the account_id fallback used when the profile carries no
     * `ext_info.org_user_code` (outsourced staff). When unset, such sign-ins fail closed.
     * `btsSdpAppId` is the BTS application's `sdp-app-id` — a different value from `sdpAppId`.
     */
    btsAccount: z.string().optional(),
    btsSecret: z.string().optional(),
    btsSdpAppId: z.string().optional(),
    btsTokenUrl: z.string().optional(),
    accountInfoEndpoint: z.string().optional(),
  })
  // All-or-none: a partial BTS config would otherwise validate at save time and only fail inside
  // a user's sign-in.
  .superRefine(({ btsAccount, btsSecret, btsSdpAppId }, ctx) => {
    const btsFields = [btsAccount, btsSecret, btsSdpAppId];

    if (btsFields.some(Boolean) && !btsFields.every(Boolean)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'btsAccount, btsSecret and btsSdpAppId must be set together (or all left empty)',
      });
    }
  });

export type NdUcConfig = z.infer<typeof ndUcConfigGuard>;

/**
 * `open_id` and `access_token` are only used for the get_user_info call that follows; the subject
 * comes from the user info response (`ext_info.org_user_code`).
 */
export const accessTokenResponseGuard = z.object({
  access_token: z.string(),
  open_id: z.string(),
});

/**
 * Response of POST /v1.1/oauth2/get_user_info. `scope_base` covers nick_name/avatar_url/gender;
 * the rest are best-effort. The subject is `ext_info.org_user_code` (the employee code, returned
 * only for org-account authorization; matches the oidc_id clinx stores) — see getUserInfo.
 */
export const userInfoResponseGuard = z.object({
  open_id: z.string().optional(),
  nick_name: z.string().optional().nullable(),
  avatar_url: z.string().optional().nullable(),
  gender: z.unknown().optional(),
  real_name: z.string().optional().nullable(),
  user_id: z.unknown().optional(),
  ext_info: z.object({ org_user_code: z.string().optional() }).optional().nullable(),
});

export const btsTokenResponseGuard = z.object({
  access_token: z.string(),
  mac_key: z.string(),
});

export const accountInfoResponseGuard = z.object({
  account_type: z.string().optional(),
  account_id: z.union([z.number(), z.string()]),
});
