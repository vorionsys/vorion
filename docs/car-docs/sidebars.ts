import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  specSidebar: [
    'index',
    'quickstart',
    {
      type: 'category',
      label: 'Specification',
      items: [
        'specification/format',
        'specification/domains',
        'specification/levels',
        'specification/tiers',
        'specification/extensions',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
        'architecture/vorion-integration',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      items: [
        'security/hardening',
        'security/compliance',
      ],
    },
    {
      type: 'category',
      label: 'SDKs & Tools',
      items: [
        'sdks/typescript',
        'sdks/python',
        'sdks/cli',
      ],
    },
    'roadmap',
  ],
};
export default sidebars;
