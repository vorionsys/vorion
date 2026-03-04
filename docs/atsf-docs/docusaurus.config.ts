import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ATSF',
  tagline: 'Agentic Trust Scoring Framework - 46 Security Layers for AI Agents',
  favicon: 'img/vorion.png',
  future: { v4: true },
  url: 'https://atsf.vorion.org',
  baseUrl: '/',
  organizationName: 'voriongit',
  projectName: 'atsf',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  markdown: {
    format: 'md',
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/vorion.png',
    colorMode: { defaultMode: 'dark', disableSwitch: false, respectPrefersColorScheme: true },
    navbar: {
      title: 'ATSF',
      logo: { alt: 'ATSF Logo', src: 'img/vorion.png' },
      items: [
        { type: 'docSidebar', sidebarId: 'atsfSidebar', position: 'left', label: 'Documentation' },
        { href: 'https://basis.vorion.org', label: 'BASIS Standard', position: 'right' },
        { href: 'https://cognigate.dev', label: 'Cognigate', position: 'right' },
        { href: 'https://opensource.vorion.org', label: 'Open Source', position: 'right' },
        { href: 'https://github.com/voriongit', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Framework',
          items: [
            { label: 'Overview', to: '/' },
            { label: 'Quick Start', to: '/getting-started/quickstart' },
            { label: 'Security Layers', to: '/security/layer-reference' },
            { label: 'Roadmap', to: '/roadmap' },
          ],
        },
        {
          title: 'Ecosystem',
          items: [
            { label: 'Vorion', href: 'https://vorion.org' },
            { label: 'BASIS Standard', href: 'https://basis.vorion.org' },
            { label: 'Cognigate', href: 'https://cognigate.dev' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/voriongit' },
            { label: 'Discord', href: 'https://discord.gg/basis-protocol' },
            { label: 'Open Source', href: 'https://opensource.vorion.org' },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Vorion. ATSF released under MIT License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'bash', 'typescript', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};
export default config;
