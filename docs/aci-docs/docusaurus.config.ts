import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'CAR Specification',
  tagline: 'Categorical Agentic Registry — The Universal Standard for AI Agent Identity & Capability Certification',
  favicon: 'img/vorion.png',
  future: { v4: true },
  url: 'https://aci.vorion.org',
  baseUrl: '/',
  organizationName: 'voriongit',
  projectName: 'aci-spec',
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
      title: 'CAR Specification',
      logo: { alt: 'CAR Logo', src: 'img/vorion.png' },
      items: [
        { type: 'docSidebar', sidebarId: 'aciSidebar', position: 'left', label: 'Documentation' },
        { href: 'https://basis.vorion.org', label: 'BASIS', position: 'right' },
        { href: 'https://atsf.vorion.org', label: 'ATSF', position: 'right' },
        { href: 'https://cognigate.dev', label: 'Cognigate', position: 'right' },
        { href: 'https://agentanchorai.com', label: 'AgentAnchor', position: 'right' },
        { href: 'https://github.com/voriongit/aci-spec', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Specification',
          items: [
            { label: 'Overview', to: '/' },
            { label: 'Core Spec', to: '/specs/core' },
            { label: 'DID Method', to: '/specs/did-method' },
            { label: 'Registry API', to: '/specs/registry-api' },
          ],
        },
        {
          title: 'Ecosystem',
          items: [
            { label: 'Vorion', href: 'https://vorion.org' },
            { label: 'BASIS Standard', href: 'https://basis.vorion.org' },
            { label: 'ATSF Framework', href: 'https://atsf.vorion.org' },
            { label: 'Cognigate', href: 'https://cognigate.dev' },
            { label: 'AgentAnchor', href: 'https://agentanchorai.com' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/voriongit/aci-spec' },
            { label: 'Open Source', href: 'https://opensource.vorion.org' },
            { label: 'Discord', href: 'https://discord.gg/basis-protocol' },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Vorion. CAR Specification released under Apache-2.0 License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'bash', 'typescript', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};
export default config;
