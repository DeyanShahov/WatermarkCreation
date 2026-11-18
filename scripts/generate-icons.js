// Icon generation script for PWA
// Run with: node scripts/generate-icons.js

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const inputSvg = path.resolve('public/icon.svg');
const outputDir = path.resolve('public/icons');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function generateIcons() {
  try {
    console.log('🔄 Generating PWA icons from SVG...');
    
    // Read the SVG
    const svgBuffer = fs.readFileSync(inputSvg);
    
    // Generate 192x192 icon (maskable)
    await sharp(svgBuffer)
      .resize(192, 192, { fit: 'contain', background: { r: 11, g: 18, b: 32, alpha: 1 } })
      .png()
      .toFile(path.join(outputDir, 'icon-192.png'));
    console.log('✅ Generated icon-192.png');
    
    // Generate 512x512 icon (maskable)
    await sharp(svgBuffer)
      .resize(512, 512, { fit: 'contain', background: { r: 11, g: 18, b: 32, alpha: 1 } })
      .png()
      .toFile(path.join(outputDir, 'icon-512.png'));
    console.log('✅ Generated icon-512.png');
    
    // Generate 180x180 Apple touch icon
    await sharp(svgBuffer)
      .resize(180, 180, { fit: 'contain', background: { r: 11, g: 18, b: 32, alpha: 1 } })
      .png()
      .toFile(path.join(outputDir, 'apple-touch-icon.png'));
    console.log('✅ Generated apple-touch-icon.png');
    
    // Generate additional sizes for better PWA support
    const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
    for (const size of sizes) {
      await sharp(svgBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 11, g: 18, b: 32, alpha: 1 } })
        .png()
        .toFile(path.join(outputDir, `icon-${size}.png`));
      console.log(`✅ Generated icon-${size}.png`);
    }
    
    console.log('\n🎉 All icons generated successfully!');
    console.log(`📁 Output directory: ${outputDir}`);
    
  } catch (error) {
    console.error('❌ Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();