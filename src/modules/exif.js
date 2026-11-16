/**
 * EXIF reading module - extracts GPS, date/time, and other metadata from image files.
 * Uses a lightweight approach without heavy dependencies.
 */

/**
 * Read EXIF data from a file/blob.
 * Returns GPS coordinates, date/time, and other useful metadata.
 *
 * @param {File|Blob} file
 * @returns {Promise<{ gps?: object, dateTime?: string, make?: string, model?: string, orientation?: number }|null>}
 */
export async function readExifData(file) {
  // Use a simple approach: read the file as ArrayBuffer and parse EXIF manually
  // For a more robust solution, we could use exifr or similar, but let's keep it lightweight

  try {
    const arrayBuffer = await file.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // Check for JPEG SOI marker
    if (view.getUint16(0) !== 0xFFD8) {
      return null; // Not a JPEG
    }

    let offset = 2;
    const length = view.byteLength;

    while (offset < length - 1) {
      if (view.getUint8(offset) !== 0xFF) break;
      const marker = view.getUint8(offset + 1);

      // APP1 marker (EXIF)
      if (marker === 0xE1) {
        const segmentLength = view.getUint16(offset + 2);
        const exifData = parseExifSegment(view, offset + 4, segmentLength - 2);
        if (exifData) return exifData;
      }

      // Move to next segment
      const segmentLength = view.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }

    return null;
  } catch (error) {
    console.warn('EXIF read failed:', error);
    return null;
  }
}

/**
 * Parse EXIF segment data.
 */
function parseExifSegment(view, offset, length) {
  // Check for "Exif\0\0" header
  const header = String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
    view.getUint8(offset + 4),
    view.getUint8(offset + 5)
  );

  if (header !== 'Exif\0\0') return null;

  // TIFF header starts at offset + 6
  const tiffOffset = offset + 6;
  return parseTiff(view, tiffOffset);
}

/**
 * Parse TIFF/EXIF structure.
 */
function parseTiff(view, offset) {
  // Byte order: II (little-endian) or MM (big-endian)
  const byteOrder = view.getUint16(offset, true); // Assume little-endian for now
  const isLittleEndian = byteOrder === 0x4949; // 'II'

  // First IFD offset
  const firstIfdOffset = view.getUint32(offset + 4, isLittleEndian);
  const ifdOffset = offset + firstIfdOffset;

  return parseIfd(view, ifdOffset, isLittleEndian, offset);
}

/**
 * Parse Image File Directory (IFD).
 */
function parseIfd(view, offset, isLittleEndian, tiffBase) {
  const numEntries = view.getUint16(offset, isLittleEndian);
  const result = {};

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = offset + 2 + i * 12;
    const tag = view.getUint16(entryOffset, isLittleEndian);
    const type = view.getUint16(entryOffset + 2, isLittleEndian);
    const count = view.getUint32(entryOffset + 4, isLittleEndian);
    const valueOffset = view.getUint32(entryOffset + 8, isLittleEndian);

    // Read value based on type and count
    const value = readValue(view, entryOffset + 8, type, count, isLittleEndian, tiffBase + valueOffset);

    // Process known tags
    switch (tag) {
      case 0x010F: // Make
        result.make = value;
        break;
      case 0x0110: // Model
        result.model = value;
        break;
      case 0x0132: // DateTime
        result.dateTime = parseDateTime(value);
        break;
      case 0x0112: // Orientation
        result.orientation = value;
        break;
      case 0x8769: // ExifSubIFD
        const exifData = parseIfd(view, tiffBase + value, isLittleEndian, tiffBase);
        Object.assign(result, exifData);
        break;
      case 0x8825: // GPSInfoIFD
        const gpsData = parseGpsIfd(view, tiffBase + value, isLittleEndian, tiffBase);
        if (gpsData) result.gps = gpsData;
        break;
    }
  }

  return result;
}

/**
 * Parse GPS IFD.
 */
function parseGpsIfd(view, offset, isLittleEndian, tiffBase) {
  const numEntries = view.getUint16(offset, isLittleEndian);
  const gps = {};

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = offset + 2 + i * 12;
    const tag = view.getUint16(entryOffset, isLittleEndian);
    const type = view.getUint16(entryOffset + 2, isLittleEndian);
    const count = view.getUint32(entryOffset + 4, isLittleEndian);
    const valueOffset = view.getUint32(entryOffset + 8, isLittleEndian);

    const value = readValue(view, entryOffset + 8, type, count, isLittleEndian, tiffBase + valueOffset);

    switch (tag) {
      case 0x0001: // GPSLatitudeRef
        gps.latRef = value;
        break;
      case 0x0002: // GPSLatitude
        gps.latitude = convertDmsToDecimal(value, gps.latRef);
        break;
      case 0x0003: // GPSLongitudeRef
        gps.lonRef = value;
        break;
      case 0x0004: // GPSLongitude
        gps.longitude = convertDmsToDecimal(value, gps.lonRef);
        break;
      case 0x0005: // GPSAltitudeRef
        gps.altRef = value;
        break;
      case 0x0006: // GPSAltitude
        gps.altitude = value * (gps.altRef === 1 ? -1 : 1);
        break;
      case 0x0007: // GPSTimeStamp
        gps.timeStamp = value;
        break;
      case 0x001B: // GPSDOP (Dilution of Precision) - accuracy estimate
        gps.accuracy = value;
        break;
    }
  }

  if (gps.latitude != null && gps.longitude != null) {
    return {
      latitude: gps.latitude,
      longitude: gps.longitude,
      altitude: gps.altitude,
      accuracy: gps.accuracy,
    };
  }

  return null;
}

/**
 * Read a value from the DataView based on EXIF type.
 */
function readValue(view, offset, type, count, isLittleEndian, dataOffset) {
  // Type 1 = BYTE, 2 = ASCII, 3 = SHORT, 4 = LONG, 5 = RATIONAL
  // 7 = UNDEFINED, 9 = SLONG, 10 = SRATIONAL

  // For small values (<= 4 bytes), the value is stored directly at offset
  // For larger values, dataOffset points to the actual data
  const isInline = count * getTypeSize(type) <= 4;
  const readOffset = isInline ? offset : dataOffset;

  switch (type) {
    case 2: // ASCII
      return readString(view, readOffset, count);
    case 3: // SHORT (16-bit unsigned)
      if (count === 1) return view.getUint16(readOffset, isLittleEndian);
      return readArray(view, readOffset, count, isLittleEndian, 'getUint16');
    case 4: // LONG (32-bit unsigned)
      if (count === 1) return view.getUint32(readOffset, isLittleEndian);
      return readArray(view, readOffset, count, isLittleEndian, 'getUint32');
    case 5: // RATIONAL (two LONGs)
      return readRationals(view, readOffset, count, isLittleEndian);
    case 9: // SLONG (32-bit signed)
      if (count === 1) return view.getInt32(readOffset, isLittleEndian);
      return readArray(view, readOffset, count, isLittleEndian, 'getInt32');
    case 10: // SRATIONAL (two SLONGs)
      return readSRationals(view, readOffset, count, isLittleEndian);
    default:
      return null;
  }
}

function getTypeSize(type) {
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  return sizes[type] || 1;
}

function readString(view, offset, length) {
  let str = '';
  for (let i = 0; i < length; i++) {
    const char = view.getUint8(offset + i);
    if (char === 0) break;
    str += String.fromCharCode(char);
  }
  return str;
}

function readArray(view, offset, count, isLittleEndian, method) {
  const arr = [];
  const size = method === 'getUint16' || method === 'getInt16' ? 2 : 4;
  for (let i = 0; i < count; i++) {
    arr.push(view[method](offset + i * size, isLittleEndian));
  }
  return arr;
}

function readRationals(view, offset, count, isLittleEndian) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const num = view.getUint32(offset + i * 8, isLittleEndian);
    const den = view.getUint32(offset + i * 8 + 4, isLittleEndian);
    arr.push(den !== 0 ? num / den : 0);
  }
  return count === 1 ? arr[0] : arr;
}

function readSRationals(view, offset, count, isLittleEndian) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const num = view.getInt32(offset + i * 8, isLittleEndian);
    const den = view.getInt32(offset + i * 8 + 4, isLittleEndian);
    arr.push(den !== 0 ? num / den : 0);
  }
  return count === 1 ? arr[0] : arr;
}

/**
 * Convert DMS (degrees, minutes, seconds) to decimal degrees.
 */
function convertDmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const degrees = dms[0];
  const minutes = dms[1];
  const seconds = dms[2];
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return decimal;
}

/**
 * Parse EXIF DateTime string (format: "YYYY:MM:DD HH:MM:SS").
 */
function parseDateTime(str) {
  if (!str) return null;
  const match = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );
}