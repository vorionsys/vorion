/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  standardSidebar: [
    {
      type: 'doc',
      id: 'index',
      label: 'What is BASIS?',
    },
    {
      type: 'category',
      label: 'The Five Stages',
      collapsed: false,
      items: [
        'layers/car',
        'layers/intent',
        'layers/enforce',
        'layers/proof',
        'layers/chain',
      ],
    },
    {
      type: 'category',
      label: 'Specification',
      items: [
        'spec/overview',
        'spec/capabilities',
        'spec/risk-classification',
        'spec/trust-scoring',
        'spec/policies',
        'spec/audit-logging',
      ],
    },
    {
      type: 'category',
      label: 'Implementation',
      items: [
        'implement/getting-started',
        'implement/compliance-tests',
        'implement/certification',
      ],
    },
    {
      type: 'doc',
      id: 'cognigate',
      label: 'Cognigate',
    },
    {
      type: 'doc',
      id: 'vorion-platform',
      label: 'Vorion Platform',
    },
    {
      type: 'doc',
      id: 'community',
      label: 'Community',
    },
  ],
};

export default sidebars;
