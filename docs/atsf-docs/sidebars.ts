import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';
const sidebars: SidebarsConfig = {
  atsfSidebar: [
    'index',
    {
      type: 'category',
      label: 'Getting Started',
      items: ['getting-started/quickstart'],
    },
    {
      type: 'category',
      label: 'Security Layers',
      items: ['security/layer-reference'],
    },
    {
      type: 'category',
      label: 'Integration',
      items: ['integration/stpa-trism-mapper'],
    },
    'roadmap',
  ],
};
export default sidebars;
