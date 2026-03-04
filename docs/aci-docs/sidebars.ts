import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  aciSidebar: [
    'index',
    {
      type: 'category',
      label: 'Core Specifications',
      items: [
        'specs/core',
        'specs/extensions',
        'specs/did-method',
        'specs/openid-claims',
        'specs/registry-api',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      items: [
        'security/hardening',
        'security/semantic-governance',
        'security/owasp-cheatsheet',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/quickstart',
        'guides/integration',
        'guides/framework-analysis',
      ],
    },
    'vocabulary',
  ],
};
export default sidebars;
