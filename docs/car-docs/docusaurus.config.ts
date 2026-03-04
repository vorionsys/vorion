import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'CAR Specification',
  tagline: 'Categorical Agentic Registry - The Certification Standard for Autonomous Agents',
  favicon: 'img/vorion.png',

  future: {
    v4: true,
  },

  url: 'https://car.vorion.org',
  baseUrl: '/',

  organizationName: 'voriongit',
  projectName: 'car-spec',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  markdown: {
    format: 'md',
  },

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
          editUrl: 'https://github.com/voriongit/car-spec/tree/main/',
        },
        blog: false,
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
    navbar: {
      title: 'CAR Specification',
      logo: {
        alt: 'CAR Logo',
        src: 'img/vorion.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'specSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://npmjs.com/package/@vorionsys/car-spec',
          label: 'CAR Spec',
          position: 'right',
        },
        {
          href: 'https://basis.vorion.org',
          label: 'BASIS',
          position: 'right',
        },
        {
          href: 'https://atsf.vorion.org',
          label: 'ATSF',
          position: 'right',
        },
        {
          href: 'https://cognigate.dev',
          label: 'Cognigate',
          position: 'right',
        },
        {
          href: 'https://github.com/voriongit/vorion',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Overview', to: '/' },
            { label: 'Quick Start', to: '/quickstart' },
            { label: 'CAR String Format', to: '/specification/format' },
            { label: 'Domains & Levels', to: '/specification/domains' },
          ],
        },
        {
          title: 'Ecosystem',
          items: [
            { label: 'Vorion', href: 'https://vorion.org' },
            { label: 'CAR Specification', href: 'https://npmjs.com/package/@vorionsys/car-spec' },
            { label: 'BASIS Standard', href: 'https://basis.vorion.org' },
            { label: 'ATSF Framework', href: 'https://atsf.vorion.org' },
            { label: 'Cognigate', href: 'https://cognigate.dev' },
            { label: 'AgentAnchor', href: 'https://agentanchorai.com' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/voriongit/vorion' },
            { label: 'Discord', href: 'https://discord.gg/basis-protocol' },
            { label: 'Open Source', href: 'https://opensource.vorion.org' },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Vorion. CAR Specification released under Apache 2.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'typescript', 'json', 'http'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
