/**
 * Watermark module: burns coordinates, altitude, timestamp, address, weather,
 * QR code, photo number, category, step, and description into the pixels.
 *
 * This is the only code path that re-encodes the photo (canvas -> JPEG). It is
 * capped at `maxEdge` pixels so a high-res photo cannot exhaust phone memory,
 * and it always runs on a copy - the untouched original stays available.
 */

import { canvasToBlob, createCanvas, decodeImage, imageSize } from '../utils/image.js';
import {
  formatAccuracy,
  formatAltitude,
  formatDateTime,
  formatDecimal,
  formatDms,
  dmsString,
} from '../utils/coords.js';
import { paintQrMatrix, qrPayloadForWatermark } from './qr.js';
import { readExifData } from './exif.js';

// Re-export readExifData for convenience
export { readExifData };

function roundRect(context, x, y, width, height, radius) {
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapText(context, text, maxWidth, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.join(' ').length < String(text).length) {
    lines[maxLines - 1] = `${lines[maxLines - 1] ?? ''}\u2026`;
  }
  return lines;
}

/**
 * Line model of the original "Image Coordinate" watermark.
 *
 * Empty inputs are simply skipped - nothing is invented for them:
 *  - coordinates: both values, only latitude, only longitude, or none;
 *  - accuracy / altitude: shown only when provided;
 *  - brand: omitted when left empty.
 * The meta line (`Genauigkeit … · … m ü.NN · date`) keeps its order.
 *
 * Exported so the quick-marking flow (and tests) can inspect the composition.
 */
export function classicLines(context, width, padding, coordSize, metaSize, options) {
  const { fix = null, address = null, capturedAt = new Date(), brand = '', weather = null } = options;
  // A whitespace-only field counts as empty too.
  const cleanAddress = typeof address === 'string' && address.trim() !== '' ? address : null;
  const latOk = Boolean(fix) && Number.isFinite(fix.latitude);
  const lonOk = Boolean(fix) && Number.isFinite(fix.longitude);

  const lines = [];

  // Coordinates: whatever was actually entered.
  if (latOk && lonOk) {
    lines.push({ text: formatDecimal(fix.latitude, fix.longitude), size: coordSize, weight: '700' });
    lines.push({ text: formatDms(fix.latitude, fix.longitude), size: metaSize, weight: '500' });
  } else if (latOk || lonOk) {
    const single = latOk ? fix.latitude : fix.longitude;
    const hemisphere = latOk ? ['N', 'S'] : ['E', 'W'];
    lines.push({ text: single.toFixed(6), size: coordSize, weight: '700' });
    lines.push({ text: dmsString(single, hemisphere[0], hemisphere[1]), size: metaSize, weight: '500' });
  }

  const metaBits = [];
  if (fix && Number.isFinite(fix.accuracy)) metaBits.push(`Genauigkeit ${formatAccuracy(fix.accuracy)}`);
  if (fix && Number.isFinite(fix.altitude)) metaBits.push(formatAltitude(fix.altitude, fix.altitudeAccuracy, ' \u00fc.NN'));
  metaBits.push(formatDateTime(capturedAt, 'de-DE'));
  lines.push({ text: metaBits.join(' \u00b7 '), size: metaSize, weight: '500' });

  if (brand) lines.push({ text: brand, size: Math.max(10, Math.round(metaSize * 0.85)), weight: '600' });

  if (cleanAddress) {
    context.font = `${metaSize}px system-ui, sans-serif`;
    for (const line of wrapText(context, cleanAddress, width - padding * 2, 2)) {
      lines.push({ text: line, size: metaSize, weight: '400' });
    }
  }

  if (weather && Number.isFinite(weather.temperature) && Number.isFinite(weather.humidity)) {
    lines.push({
      text: `\uD83C\uDF21\uFE0F ${Math.round(weather.temperature)}\u00b0C \u00b7 \uD83D\uDCA7 ${Math.round(weather.humidity)}%`,
      size: metaSize,
      weight: '500',
    });
  }

  return lines;
}

/**
 * Big white monospace badge in a corner, optionally followed by a short text.
 *
 * Shared by the "number only" mode and the combined "watermark + number" mode,
 * where the number is a separate mark pinned to the top-left corner.
 */
function drawCornerBadge(context, width, height, padding, { text, suffix = '', position = 'bottom-right' } = {}) {
  if (!text) return;

  const displayText = suffix ? `${text} ${suffix}` : String(text);
  const numberFontSize = Math.max(24, Math.round(width / 20));
  context.save();
  context.font = `700 ${numberFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.shadowColor = 'rgba(0, 0, 0, 0.7)';
  context.shadowBlur = Math.round(numberFontSize * 0.4);
  context.fillStyle = '#ffffff';
  context.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  context.lineWidth = Math.max(2, Math.round(numberFontSize / 12));

  let x;
  let y;
  switch (position) {
    case 'top-left':
      x = padding; y = padding; context.textAlign = 'left'; context.textBaseline = 'top';
      break;
    case 'top-right':
      x = width - padding; y = padding; context.textAlign = 'right'; context.textBaseline = 'top';
      break;
    case 'bottom-left':
      x = padding; y = height - padding; context.textAlign = 'left'; context.textBaseline = 'bottom';
      break;
    case 'bottom-right':
    default:
      x = width - padding; y = height - padding; context.textAlign = 'right'; context.textBaseline = 'bottom';
      break;
  }

  // Stroke first for contrast, then fill.
  context.strokeText(displayText, x, y);
  context.fillText(displayText, x, y);
  context.restore();
}

/**
 * @param {Blob} blob JPEG/PNG source
 * @param {{
 *   fix?: object|null,
 *   address?: string|null,
 *   capturedAt?: Date,
 *   maxEdge?: number,
 *   quality?: number,
 *   brand?: string,
 *   look?: 'classic'|null,
 *   cornerBadge?: { text: string|number, suffix?: string, position?: string }|null,
 *   qrMatrix?: { count: number, rows: number[][] }|null,
 *   weather?: { temperature: number, humidity: number }|null,
 *   photoNumber?: number,
 *   totalPhotos?: number,
 *   category?: string,
 *   step?: string,
 *   description?: string,
 *   stepMessage?: string,
 *   showCoordinates?: boolean,
 *   showAltitude?: boolean,
 *   showDateTime?: boolean,
 *   showAddress?: boolean,
 *   showWeather?: boolean,
 *   showQrCode?: boolean,
 *   showPhotoNumber?: boolean,
 *   showCategoryStep?: boolean,
 *   showDescription?: boolean,
 * }} options
 * @returns {Promise<{ blob: Blob, scaled: boolean, width: number, height: number }>}
 */
export async function withWatermark(blob, options = {}) {
  const {
    fix = null,
    address = null,
    capturedAt = new Date(),
    maxEdge = 4096,
    quality = 0.92,
    brand = 'Watermark Creation',
    look = null, // 'classic' reproduces the "Image Coordinate" panel exactly
    cornerBadge = null, // { text, suffix?, position? } - separate mark over the panel
    qrMatrix = null,
    weather = null,
    photoNumber = null,
    totalPhotos = null,
    category = null,
    step = null,
    description = null,
    stepMessage = null,
    showCoordinates = true,
    showAltitude = true,
    showDateTime = true,
    showAddress = true,
    showWeather = true,
    showQrCode = true,
    showPhotoNumber = true,
    showCategoryStep = true,
    showDescription = true,
    numberPosition = 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    numberFormat = 'full', // 'full' | 'number' - 'full' = "Снимка 1 от 5", 'number' = "1"
    includeStepMessage = false, // Include step message with number
  } = options;

  const image = await decodeImage(blob);
  const source = imageSize(image);
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context not available.');
  context.drawImage(image, 0, 0, width, height);
  if (typeof image.close === 'function') image.close();

  const hasFix = Boolean(fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude));
  const padding = Math.round(width * 0.035);
  const coordSize = Math.max(16, Math.round(width / 30));
  const metaSize = Math.max(12, Math.round(width / 55));
  const lineHeight = Math.round(coordSize * 1.35);

  // Check if NUMBER ONLY mode (only photo number, no other metadata)
  const classic = look === 'classic';
  const isNumberOnlyMode = !classic && showPhotoNumber &&
    !showCoordinates && !showAltitude && !showDateTime &&
    !showAddress && !showWeather && !showQrCode &&
    !showCategoryStep && !showDescription;

  const lines = [];

  // Coordinates line
  if (showCoordinates && hasFix) {
    lines.push({ text: formatDecimal(fix.latitude, fix.longitude), size: coordSize, weight: '700' });
    lines.push({ text: formatDms(fix.latitude, fix.longitude), size: metaSize, weight: '500' });
  } else if (showCoordinates && !hasFix) {
    lines.push({ text: 'Няма GPS координати', size: coordSize, weight: '700' });
  }

  // Meta bits: accuracy, altitude, date/time
  const metaBits = [];
  if (hasFix && Number.isFinite(fix.accuracy)) metaBits.push(`Точност ${formatAccuracy(fix.accuracy)}`);
  if (showAltitude && hasFix && Number.isFinite(fix.altitude)) metaBits.push(formatAltitude(fix.altitude));
  if (showDateTime) metaBits.push(formatDateTime(capturedAt));
  if (metaBits.length > 0) {
    lines.push({ text: metaBits.join(' · '), size: metaSize, weight: '500' });
  }

  // Address
  if (showAddress && address) {
    context.font = `${metaSize}px system-ui, sans-serif`;
    const maxTextWidth = width - padding * 2;
    const addressLines = wrapText(context, address, maxTextWidth, 2);
    for (const line of addressLines) {
      lines.push({ text: line, size: metaSize, weight: '400' });
    }
  }

  // Weather
  if (showWeather && weather && Number.isFinite(weather.temperature) && Number.isFinite(weather.humidity)) {
    const tempStr = `${Math.round(weather.temperature)}°C`;
    const humStr = `${Math.round(weather.humidity)}%`;
    lines.push({ text: `🌡️ ${tempStr} · 💧 ${humStr}`, size: metaSize, weight: '500' });
  }

  // Photo number and category/step
  if (showPhotoNumber && (photoNumber || totalPhotos)) {
    let numText;
    if (numberFormat === 'number') {
      // Only the number: "1", "2", "3"
      numText = String(photoNumber);
    } else {
      // Full format: "Снимка 1 от 5" or "Снимка 1"
      numText = totalPhotos ? `Снимка ${photoNumber} от ${totalPhotos}` : `Снимка ${photoNumber}`;
    }
    lines.push({ text: numText, size: metaSize, weight: '600' });
  }

  if (showCategoryStep && (category || step)) {
    const catStepText = [];
    if (category) catStepText.push(`Категория: ${category}`);
    if (step) catStepText.push(`Стъпка: ${step}`);
    lines.push({ text: catStepText.join(' | '), size: metaSize, weight: '500' });
  }

  // Description
  if (showDescription && description) {
    context.font = `${metaSize}px system-ui, sans-serif`;
    const maxTextWidth = width - padding * 2;
    const descLines = wrapText(context, description, maxTextWidth, 2);
    for (const line of descLines) {
      lines.push({ text: line, size: metaSize, weight: '400' });
    }
  }

  // Step Message (custom message for watermark)
  if (showDescription && stepMessage) {
    context.font = `${metaSize}px system-ui, sans-serif`;
    const maxTextWidth = width - padding * 2;
    const msgLines = wrapText(context, stepMessage, maxTextWidth, 2);
    for (const line of msgLines) {
      lines.push({ text: `💬 ${line}`, size: metaSize, weight: '500' });
    }
  }

  // Brand
  lines.push({ text: brand, size: Math.max(10, Math.round(metaSize * 0.85)), weight: '600' });

  // "Image Coordinate" look: replace whatever the default composition produced
  // with the original line order, wording and units.
  if (classic) {
    lines.length = 0;
    lines.push(...classicLines(context, width, padding, coordSize, metaSize, options));
  }

  if (isNumberOnlyMode) {
    // NUMBER ONLY MODE: Draw only the photo number at specified position, no panel
    const numberLine = lines.find(l => l.text.includes('Снимка'));
    // Format number text based on numberFormat option
    let numberText;
    if (numberFormat === 'number') {
      // Just the number: "1", "2", "3"
      numberText = photoNumber ? String(photoNumber) : '';
    } else {
      // Full format: "Снимка 1 от 5" or "Снимка 1"
      numberText = numberLine ? numberLine.text : (photoNumber ? `Снимка ${photoNumber}` : '');
    }
    
    if (numberText) {
      // If includeStepMessage is enabled and stepMessage exists, append it to the number.
      const displayText = includeStepMessage && stepMessage ? `${numberText} — ${stepMessage}` : numberText;
      drawCornerBadge(context, width, height, padding, { text: displayText, position: numberPosition });
    }
  } else {
    // FULL MODE: Draw panel with all metadata
    // Calculate panel height
    const panelHeight =
      lines.reduce((total, line) => total + Math.round(line.size * 1.45), 0) + padding * 1.4;
    const panelY = height - panelHeight - padding / 2;

    // Draw gradient background for the panel area
    context.save();
    const gradient = context.createLinearGradient(0, panelY, 0, height);
    gradient.addColorStop(0, 'rgba(4, 8, 16, 0)');
    gradient.addColorStop(0.35, 'rgba(4, 8, 16, 0.6)');
    gradient.addColorStop(1, 'rgba(4, 8, 16, 0.88)');
    context.fillStyle = gradient;
    context.fillRect(0, Math.max(0, panelY - padding), width, height - Math.max(0, panelY - padding));
    context.restore();

    // Draw rounded panel background
    roundRect(
      context,
      padding * 0.6,
      panelY - padding * 0.3,
      width - padding * 1.2,
      panelHeight,
      Math.round(padding * 0.45),
    );
    context.fillStyle = 'rgba(6, 10, 20, 0.55)';
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = Math.max(1, width / 1400);
    context.stroke();

    // Draw text lines
    context.save();
    context.textBaseline = 'top';
    context.shadowColor = 'rgba(0, 0, 0, 0.55)';
    context.shadowBlur = Math.round(metaSize * 0.5);
    let cursorY = panelY + padding * 0.35;
    for (const line of lines) {
      context.font = `${line.weight} ${line.size}px ${
        line.weight === '700' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'system-ui, sans-serif'
      }`;
      context.fillStyle = line.weight === '700' ? '#ffffff' : 'rgba(240, 246, 255, 0.92)';
      context.fillText(line.text, padding, cursorY);
      cursorY += Math.round(line.size * 1.45);
    }
    context.restore();

    // Optional QR code in the bottom-right corner of the watermark panel.
    if (showQrCode && qrMatrix) {
      const qrSize = Math.max(96, Math.round(width * 0.2));
      const qrMargin = Math.round(width * 0.02);
      // Position QR code at the right edge of the watermark panel, vertically centered.
      const panelRight = width - padding * 1.2;
      const panelTop = panelY - padding * 0.3;
      // Ensure QR code fits within panel height (with small margin)
      const maxQrSize = Math.max(0, panelHeight - padding * 0.4);
      const constrainedQrSize = Math.min(qrSize, maxQrSize);
      paintQrMatrix(context, qrMatrix, {
        x: panelRight - constrainedQrSize,
        y: panelTop + (panelHeight - constrainedQrSize) / 2,
        size: constrainedQrSize,
        quietZone: 2,
        light: '#ffffff',
        dark: '#04080f',
      });
    }

    // Combined mode ("watermark + number"): the number is a separate mark and,
    // when a watermark is present, its only place is the top-left corner.
    if (cornerBadge && cornerBadge.text) {
      drawCornerBadge(context, width, height, padding, {
        text: String(cornerBadge.text),
        suffix: cornerBadge.suffix || '',
        position: cornerBadge.position || 'top-left',
      });
    }
  }

  const watermarked = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: watermarked, scaled: scale < 1, width, height };
}

/**
 * Creates a QR matrix for the watermark with all photo data.
 * @param {object} data - Photo data for QR code
 * @returns {Promise<{ count: number, rows: number[][] }|null>}
 */
export async function createWatermarkQrMatrix(data) {
  const payload = qrPayloadForWatermark(data);
  return paintQrMatrix ? null : null; // Will use the imported createQrMatrix from qr.js
}

// Re-export createQrMatrix for convenience
export { createQrMatrix } from './qr.js';