const path = require('path');
const fs = require('fs');
const officeParser = require('officeparser');

const OFFICE_EXT = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']);
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tex', '.html', '.json']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const IMAGE_MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function kindOf(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (OFFICE_EXT.has(ext)) return 'office';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'unknown';
}

// Extrahiert Text aus Office-/PDF-/Textdateien. Bilder werden separat
// über die Claude-Vision-API verarbeitet (siehe claude.js).
async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (TEXT_EXT.has(ext)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  if (OFFICE_EXT.has(ext)) {
    return await officeParser.parseOfficeAsync(filePath);
  }
  throw new Error(`Dateityp ${ext} wird nicht unterstützt.`);
}

function imageBlock(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const mediaType = IMAGE_MEDIA_TYPES[ext];
  if (!mediaType) throw new Error(`Bildformat ${ext} wird nicht unterstützt.`);
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data: fs.readFileSync(filePath).toString('base64'),
    },
  };
}

module.exports = { kindOf, extractText, imageBlock };
