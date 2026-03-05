// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'BASIS',
  tagline: 'The Open Standard for AI Agent Governance',
  favicon: 'img/favicon.svg',

  url: 'https://basis.vorion.org',
  baseUrl: '/',
  trailingSlash: false,

  organizationName: 'vorionsys',
  projectName: 'vorion',

  onBrokenLinks: 'throw',

  future: {
    v4: true,
  },

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/vorionsys/vorion/tree/main/',
          routeBasePath: '/',
        },
        blog: {
          showReadingTime: true,
          editUrl: 'https://github.com/vorionsys/vorion/tree/main/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
      ({
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        docsRouteBasePath: '/',
        indexBlog: true,
        indexDocs: true,
        searchBarShortcutHint: true,
        searchBarPosition: 'right',
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/vorion.png',
      navbar: {
        title: 'BASIS',
        logo: {
          alt: 'BASIS Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'standardSidebar',
            position: 'left',
            label: 'Standard',
          },
          {
            to: '/cognigate',
            label: 'Cognigate',
            position: 'left',
          },
          {
            to: '/vorion-platform',
            label: 'Vorion Platform',
            position: 'left',
          },
          {
            to: '/community',
            label: 'Community',
            position: 'left',
          },
          {
            href: 'https://github.com/voriongit',
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
            title: 'Standard',
            items: [
              { label: 'Overview', to: '/' },
              { label: 'CAR', to: '/layers/car' },
              { label: 'INTENT', to: '/layers/intent' },
              { label: 'ENFORCE', to: '/layers/enforce' },
              { label: 'PROOF', to: '/layers/proof' },
              { label: 'CHAIN', to: '/layers/chain' },
            ],
          },
          {
            title: 'Products',
            items: [
              { label: 'Cognigate', to: '/cognigate' },
              { label: 'Vorion Platform', href: 'https://vorion.org' },
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
              { label: 'Blog', to: '/blog' },
              { label: 'Vorion', href: 'https://vorion.org' },
            ],
          },
        ],
        copyright: `© ${new Date().getFullYear()} Vorion. BASIS Standard released under CC BY 4.0.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'python', 'yaml', 'solidity', 'typescript'],
      },
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
    }),
};

export default config;
