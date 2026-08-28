import type { ConnectorMetadata } from '@logto/connector-kit';
import { ConnectorPlatform, ConnectorConfigFormItemType } from '@logto/connector-kit';
import {
  authorizationEndpointFormItem,
  clientIdFormItem,
  clientSecretFormItem,
  tokenEndpointFormItem,
} from '@logto/connector-oauth';

export const defaultScope = 'scope_base';

export const defaultMobileAuthorizationEndpoint = 'https://uc-aq.sdp.101.com';

export const defaultBtsTokenUrl = 'https://ucbts.101.com/v1/tokens';

export const defaultAccountInfoEndpoint =
  'https://uc-gateway.sdp.101.com/v1.1/idp/get_account_info';

export const defaultMetadata: ConnectorMetadata = {
  id: 'nd-uc-universal',
  target: 'nd-uc',
  platform: ConnectorPlatform.Universal,
  name: {
    en: 'ND UC',
    'zh-CN': 'ND UC',
    'tr-TR': 'ND UC',
    ko: 'ND UC',
  },
  logo: './logo.svg',
  logoDark: null,
  description: {
    en: 'ND UC is the unified identity service of NetDragon; products such as 99u sign in through it.',
    'zh-CN': 'ND UC 是网龙统一身份认证服务,99u 等产品经由它登录。',
    'tr-TR':
      'ND UC is the unified identity service of NetDragon; products such as 99u sign in through it.',
    ko: 'ND UC is the unified identity service of NetDragon; products such as 99u sign in through it.',
  },
  readme: './README.md',
  formItems: [
    { ...clientIdFormItem, description: 'IDP-assigned application id for the OAuth2 flow.' },
    {
      ...clientSecretFormItem,
      description: 'IDP-assigned application secret used to exchange the authorization code.',
    },
    {
      ...authorizationEndpointFormItem,
      defaultValue: 'https://uc-component.sdp.101.com',
      description:
        'uc-component origin; the connector appends the `#/oauth2/authorize` hash route.',
    },
    {
      key: 'mobileAuthorizationEndpoint',
      type: ConnectorConfigFormItemType.Text,
      label: 'Mobile Authorization Endpoint',
      required: false,
      defaultValue: defaultMobileAuthorizationEndpoint,
      description:
        'uc-aq origin, used directly for mobile user agents because uc-component drops the oauth2 query when forwarding them itself.',
    },
    {
      ...tokenEndpointFormItem,
      defaultValue: 'https://uc-gateway.sdp.101.com/v1.1/oauth2/access_token',
      description:
        'Endpoint that exchanges the authorization code for an access token and open_id.',
    },
    {
      key: 'userInfoEndpoint',
      type: ConnectorConfigFormItemType.Text,
      label: 'User Info Endpoint',
      required: true,
      defaultValue: 'https://uc-gateway.sdp.101.com/v1.1/oauth2/get_user_info',
      description: 'POST endpoint that returns the user profile for an open_id.',
    },
    {
      key: 'scope',
      type: ConnectorConfigFormItemType.Text,
      label: 'Scope',
      required: false,
      defaultValue: defaultScope,
      description:
        'Comma-separated OAuth2 scope. `scope_base` gives nickname/avatar/gender; `scope_mobile` and `scope_email` add the phone number and the email.',
    },
    {
      key: 'sdpAppId',
      type: ConnectorConfigFormItemType.Text,
      label: 'SDP App ID',
      required: false,
      placeholder: '<sdp-app-id>',
      description:
        'The ND application id. Sent as the `sdp-app-id` query parameter to the authorization page and as the `sdp-app-id` header to the UC gateway. Optional, but the authorization page shows an `sdp-app-id为空` warning when it is missing.',
    },
    {
      key: 'btsAccount',
      type: ConnectorConfigFormItemType.Text,
      label: 'BTS Account',
      required: false,
      description:
        'BTS app name, used to resolve an account_id for accounts without an employee code (outsourced staff). Leave empty to fail such sign-ins.',
    },
    {
      key: 'btsSecret',
      type: ConnectorConfigFormItemType.Text,
      label: 'BTS Secret',
      required: false,
      description: 'BTS app secret paired with the BTS account.',
    },
    {
      key: 'btsSdpAppId',
      type: ConnectorConfigFormItemType.Text,
      label: 'BTS SDP App ID',
      required: false,
      description:
        'The `sdp-app-id` header for the BTS get_account_info call. This is a different value from the SDP App ID above — do not reuse it.',
    },
    {
      key: 'btsTokenUrl',
      type: ConnectorConfigFormItemType.Text,
      label: 'BTS Token URL',
      required: false,
      defaultValue: defaultBtsTokenUrl,
      description: 'BTS token exchange endpoint.',
    },
    {
      key: 'accountInfoEndpoint',
      type: ConnectorConfigFormItemType.Text,
      label: 'Account Info Endpoint',
      required: false,
      defaultValue: defaultAccountInfoEndpoint,
      description: 'BTS-authenticated POST endpoint that maps an open_id to its account_id.',
    },
  ],
};

export const defaultTimeout = 10_000;
