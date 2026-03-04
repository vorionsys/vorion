/**
 * Process source logos into web-optimized assets.
 *
 * Generates per-app:
 *   - icon.png (180x180 — favicon + apple-touch-icon)
 *   - og-image.png (1200x630 — social share card)
 *
 * Usage: node scripts/process-logos.mjs
 */
import sharp from 'sharp';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'C:/Users/racas/Downloads/logos';
const APPS = 'apps';

const OG_W = 1200;
const OG_H = 630;
const ICON_SIZE = 180;

// Dark background for OG images (matches app bg #05050a)
const DARK_BG = { r: 5, g: 5, b: 10, alpha: 255 };

/**
 * Create an OG image: logo centered on dark background
 */
async function makeOgImage(logoPath, outPath, logoMaxH = 300) {
  const logo = await sharp(logoPath)
    .resize({ height: logoMaxH, fit: 'inside' })
    .png()
    .toBuffer();

  const logoMeta = await sharp(logo).metadata();

  const left = Math.round((OG_W - logoMeta.width) / 2);
  const top = Math.round((OG_H - logoMeta.height) / 2);

  await sharp({
    create: { width: OG_W, height: OG_H, channels: 4, background: DARK_BG },
  })
    .composite([{ input: logo, left, top }])
    .png({ quality: 85 })
    .toFile(outPath);

  console.log(`  og-image.png → ${outPath}`);
}

/**
 * Create a square icon from logo
 */
async function makeIcon(logoPath, outPath) {
  await sharp(logoPath)
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: DARK_BG })
    .png()
    .toFile(outPath);

  console.log(`  icon.png → ${outPath}`);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// ─── AgentAnchor apps (trust, logic, status, verify) ────────────────────────
const AA_LOGO = join(SOURCE, 'agent_anchor_logo_lg.png');
const AA_APPS = ['trust-www', 'logic-www', 'status-www', 'verify-www'];

for (const app of AA_APPS) {
  console.log(`\nProcessing ${app}...`);
  const pubDir = join(APPS, app, 'public');
  ensureDir(pubDir);
  await makeIcon(AA_LOGO, join(pubDir, 'icon.png'));
  await makeOgImage(AA_LOGO, join(pubDir, 'og-image.png'), 350);
}

// ─── CAR ID (Vorion brand, vorion.org domain) ───────────────────────────────
const VORION_LOGO = join(SOURCE, 'vorion logo.png');

console.log('\nProcessing carid-www...');
ensureDir(join(APPS, 'carid-www', 'public'));
await makeIcon(VORION_LOGO, join(APPS, 'carid-www', 'public', 'icon.png'));
await makeOgImage(VORION_LOGO, join(APPS, 'carid-www', 'public', 'og-image.png'), 400);

// ─── BAI-CC Dashboard (Vorion brand, reuse bai-cc-www OG or generate) ───────
console.log('\nProcessing bai-cc-dashboard...');
const dashPub = join(APPS, 'bai-cc-dashboard', 'public');
// Dashboard already has favicon.svg, just add OG image
await makeOgImage(VORION_LOGO, join(dashPub, 'og-image.png'), 400);
await makeIcon(VORION_LOGO, join(dashPub, 'apple-touch-icon.png'));

console.log('\nDone! All assets generated.');
