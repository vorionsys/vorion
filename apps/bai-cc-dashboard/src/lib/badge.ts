/**
 * SVG Badge Renderer
 *
 * Generates shields.io-style flat SVG badges.
 * Used by /api/badge/*.svg endpoints.
 */

export interface BadgeOptions {
  label: string;
  message: string;
  color: string;
  labelColor?: string;
}

const FONT_SIZE = 11;
const PADDING = 6;
const CHAR_WIDTH = 6.5; // approximate width per character at 11px Verdana

function textWidth(text: string): number {
  return Math.round(text.length * CHAR_WIDTH + PADDING * 2);
}

export function renderBadge({ label, message, color, labelColor = '555' }: BadgeOptions): string {
  const labelWidth = textWidth(label);
  const messageWidth = textWidth(message);
  const totalWidth = labelWidth + messageWidth;

  const labelX = labelWidth / 2;
  const messageX = labelWidth + messageWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#${labelColor}"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="#${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="${FONT_SIZE}">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelX}" y="14">${escapeXml(label)}</text>
    <text x="${messageX}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${messageX}" y="14">${escapeXml(message)}</text>
  </g>
</svg>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Standard badge colors */
export const COLORS = {
  brightgreen: '4c1',
  green: '97ca00',
  yellow: 'dfb317',
  orange: 'fe7d37',
  red: 'e05d44',
  blue: '007ec6',
  lightgrey: '9f9f9f',
} as const;
