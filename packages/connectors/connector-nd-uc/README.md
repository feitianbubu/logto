# ND UC connector

The ND UC connector integrates NetDragon's unified identity service (UC 1.1) as a social sign-in
method. UC is the identity platform behind products such as 99u and 福软通, so any UC-based product
account can sign in through this connector.

It uses the **standard OAuth2 authorization-code flow** exposed by the ND IDP (wiki: `IDP` page,
section 4.1 网站应用接入):

1. Logto redirects the user to the UC authorization page (uc-component) at
   `{Authorization Endpoint}/?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...&sdp-app-id=...#/oauth2/authorize`
   (`sdp-app-id` is only appended when configured).
2. After sign-in the page redirects back with `?code=...&state=...`.
3. The connector exchanges the code at `POST {Token Endpoint}` with a **JSON** body
   (`client_id` + `client_secret` + `code` + `grant_type=authorization_code`) for an `access_token`
   and an `open_id`.
4. It reads the profile from `POST {User Info Endpoint}` with `{ open_id, access_token }`.

The stable subject is `open_id`, mapped to the social user id.

## Configuration

| Field | Description | Example |
| --- | --- | --- |
| Client ID | IDP-assigned application id. | — |
| Client Secret | IDP-assigned application secret. | — |
| Authorization Endpoint | uc-component origin; `#/oauth2/authorize` is appended. | `https://uc-component.sdp.101.com` |
| Token Endpoint | Exchanges the code for an access token + open_id. | `https://uc-gateway.sdp.101.com/v1.1/oauth2/access_token` |
| User Info Endpoint | POST endpoint returning the profile for an open_id. | `https://uc-gateway.sdp.101.com/v1.1/oauth2/get_user_info` |
| Scope | Comma-separated; `scope_base` (nickname/avatar/gender), `scope_mobile`, `scope_email`. | `scope_base` |
| SDP App ID | ND application id, sent to the authorization page as a query parameter and to the gateway as the `sdp-app-id` header. Optional, but the page warns `sdp-app-id为空` without it. | — |

The `redirect_uri` must match one of the safe domains registered for this application on the ND IDP.

Hosts per environment (wiki section 9.1 接入地址); the defaults above target 生产:

| | 预生产 | 生产 |
| --- | --- | --- |
| `{uc-component}` | `uc-component.beta.101.com` | `uc-component.sdp.101.com` |
| `{uc-gateway}` | `uc-gateway.beta.101.com` | `uc-gateway.sdp.101.com` |

The wiki writes the uc-component hosts as `http://`; both answer over `https`, which is what the
defaults use.

## Notes

- ND is OAuth2, not OIDC: there is no `id_token`, the subject is `open_id`, and the user info API is
  a custom `POST` (not the standard `GET`+`Bearer`). Profiles carry no email.
- The token endpoint takes JSON, not the OAuth2-standard `application/x-www-form-urlencoded`: the
  gateway's WAF answers `415 WAF/UNSUPPORTED_MEDIA_TYPE` to a form body regardless of `charset`.
- ND user info does not return the numeric org `user_id`; if a scope surfaces it, it is preserved in
  `rawData` for legacy-account mapping. Otherwise the `open_id → user_id` mapping must be done out of
  band (IDP `5.3.1 /v1.1/idp/{access_token}`, BTS auth).
- The beta ND environment double-encodes JSON responses as a JSON string; the connector unwraps one
  level before parsing.
- Wiki 4.1.2 lists only `scope_base` (nickname/avatar/gender), `scope_mobile` and `scope_email` —
  there is no `scope_userinfo`. The connector still prefers `real_name` over `nick_name` when a
  profile carries it, but no documented scope is known to request it.
- Doc: <https://wiki.doc.101.com/index.php?title=IDP>
