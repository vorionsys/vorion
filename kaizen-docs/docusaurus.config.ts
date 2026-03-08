import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Kaizen',
  tagline: 'Interactive AI Learning Experience',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://learn.vorion.org',
  baseUrl: '/',

  organizationName: 'voriongit',
  projectName: 'kaizen',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/voriongit/vorion/tree/master/kaizen-docs/',
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/voriongit/vorion/tree/master/kaizen-docs/',
          blogTitle: 'Agentic AI Insights',
          blogDescription: 'Deep dives into autonomous agent research and development',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/vorion.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'contribute',
      content: 'Help build the definitive AI learning experience. <a href="/contributing">Contribute on GitHub</a>',
      backgroundColor: '#3b82f6',
      textColor: '#ffffff',
      isCloseable: true,
    },
    navbar: {
      title: 'Kaizen',
      logo: {
        alt: 'Kaizen Logo',
        src: 'img/vorion.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'knowledgeSidebar',
          position: 'left',
          label: 'Knowledge Base',
        },
        {
          to: '/blog',
          label: 'Insights',
          position: 'left',
        },
        {
          to: '/contributing',
          label: 'Contribute',
          position: 'left',
        },
        {
          href: 'https://basis.vorion.org',
          label: 'BASIS Standard',
          position: 'right',
        },
        {
          href: 'https://github.com/voriongit/kaizen',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://discord.gg/basis-protocol',
          label: 'Discord',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Learn',
          items: [
            { label: 'Agent Taxonomy', to: '/taxonomy' },
            { label: 'Cognitive Architecture', to: '/architecture' },
            { label: 'Orchestration', to: '/orchestration' },
            { label: 'Protocols', to: '/protocols' },
          ],
        },
        {
          title: 'Vorion Ecosystem',
          items: [
            { label: 'Vorion', href: 'https://vorion.org' },
            { label: 'BASIS Standard', href: 'https://basis.vorion.org' },
            { label: 'Cognigate', href: 'https://cognigate.dev' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'Discord', href: 'https://discord.gg/basis-protocol' },
            { label: 'GitHub', href: 'https://github.com/voriongit' },
            { label: 'Twitter', href: 'https://twitter.com/BASISprotocol' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'Insights Blog', to: '/blog' },
            { label: 'Contribute', to: '/contributing' },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Vorion. Content licensed under Apache-2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'bash', 'yaml', 'json', 'typescript', 'solidity'],
    },
    // Algolia search - configure after deployment
    // algolia: {
    //   appId: 'YOUR_APP_ID',
    //   apiKey: 'YOUR_SEARCH_API_KEY',
    //   indexName: 'kaizen',
    //   contextualSearch: true,
    // },
  } satisfies Preset.ThemeConfig,
};

export default config;
