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
