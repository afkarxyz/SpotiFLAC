import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

const svgPath = join(rootDir, 'frontend', 'public', 'icon.svg');
const outputPath = join(rootDir, 'build', 'appicon.png');

async function generateIcon() {
  try {
    // Ensure build directory exists
    mkdirSync(join(rootDir, 'build'), { recursive: true });

    // Read SVG
    const svgBuffer = readFileSync(svgPath);

    // Convert SVG to PNG (1024x1024 for Wails)
    await sharp(svgBuffer)
      .resize(1024, 1024)
      .png()
      .toFile(outputPath);

    console.log('✓ Icon generated:', outputPath);
  } catch (error) {
    console.error('✗ Failed to generate icon:', error.message);
    process.exit(1);
  }
}

generateIcon();
