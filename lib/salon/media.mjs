import {fileTypeFromBuffer} from 'file-type';
import {imageSize, disableTypes, types} from 'image-size';
// Mature version retained under the dependency age policy. Disable every parser
// except the three upload formats before any untrusted buffer can be inspected.
disableTypes(types.filter(type => !['jpg', 'png', 'webp'].includes(type)));
import {contentKinds} from './seed.mjs';
import {fail, limited} from './security.mjs';

const fields = {settings: ['heroImage', 'studioImage', 'fontUrl'], services: ['image'], gallery: ['url'], tours: ['url'], team: ['image'], offers: ['image']};
export const mediaId = url => /^\/api\/media\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(url || '')?.[1];
export const references = (kind, record, id) => (fields[kind] || []).some(field => record?.[field] === '/api/media/' + id);
export function visible(kind, record) {
  return record.published && (!(kind === 'gallery' || kind === 'testimonials') || record.consent === true) && (kind !== 'offers' || !record.endDate || record.endDate >= new Date().toISOString().slice(0, 10));
}
export async function publicMedia(store, id) {
  if (references('settings', await store.get('settings', 'main'), id)) return true;
  for (const kind of contentKinds) if ((await store.list(kind)).some(record => visible(kind, record) && references(kind, record, id))) return true;
  return false;
}
export async function mediaInUse(store, id) {
  if (references('settings', await store.get('settings', 'main'), id)) return true;
  for (const kind of contentKinds) if ((await store.list(kind)).some(record => references(kind, record, id))) return true;
  return false;
}
export async function validateAssets(store, kind, data) {
  for (const field of fields[kind] || []) {
    const id = mediaId(data[field]); if (!id) continue;
    const media = await store.get('media', id);
    const expected = field === 'fontUrl' ? 'font' : kind === 'gallery' ? data.mediaType : 'image';
    if (!media || !media.mime.startsWith(expected + '/')) fail('Choose an uploaded file of the correct type.');
    if (kind === 'tours' && (!media.panorama || !media.width || Math.abs(media.width / media.height - 2) > 0.04)) fail('Upload a verified 2:1 panoramic image for the tour.');
  }
}
const formats = {
  jpg: {mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], max: 12}, png: {mime: 'image/png', extensions: ['png'], max: 12},
  webp: {mime: 'image/webp', extensions: ['webp'], max: 12}, mp4: {mime: 'video/mp4', extensions: ['mp4'], max: 25},
  webm: {mime: 'video/webm', extensions: ['webm'], max: 25}, woff: {mime: 'font/woff', extensions: ['woff'], max: 2}, woff2: {mime: 'font/woff2', extensions: ['woff2'], max: 2},
};
export async function inspectUpload(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) fail('Send a multipart upload.', 415);
  const bytes = await limited(request, 26 * 1024 * 1024); let form;
  try { form = await new Request(request.url, {method: 'POST', headers: {'Content-Type': request.headers.get('content-type')}, body: bytes}).formData(); }
  catch { fail('The upload could not be read.'); }
  if (form.getAll('file').length !== 1 || form.getAll('panorama').length > 1 || [...form.keys()].some(k => !['file', 'panorama'].includes(k))) fail('Upload one file at a time.');
  const file = form.get('file'), panoramaFlag = form.get('panorama');
  if (!(file instanceof File) || !file.size || file.name.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) fail('Choose a file with a valid name.');
  if (panoramaFlag !== null && !['true', 'false'].includes(panoramaFlag)) fail('Invalid panorama setting.');
  const panorama = panoramaFlag === 'true', buffer = new Uint8Array(await file.arrayBuffer()); let detected;
  // Reject archives, documents and unsupported image containers before the
  // general detector can enter a parser that the salon never needs.
  const prefix = String.fromCharCode(...buffer.subarray(0, 16));
  const allowedSignature = (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    || prefix.startsWith('\x89PNG\r\n\x1a\n')
    || (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP')
    || prefix.slice(4, 8) === 'ftyp'
    || (buffer[0] === 26 && buffer[1] === 69 && buffer[2] === 223 && buffer[3] === 163)
    || prefix.startsWith('wOFF') || prefix.startsWith('wOF2');
  if (!allowedSignature) fail('This file format is not supported.');
  try { detected = await fileTypeFromBuffer(buffer); } catch { fail('This file is damaged or unsupported.'); }
  const format = detected && formats[detected.ext], extension = file.name.split('.').pop().toLowerCase();
  if (!format || !format.extensions.includes(extension)) fail('Use a valid JPG, PNG, WebP, MP4, WebM, WOFF or WOFF2 file with its correct extension.');
  if (!format.mime.startsWith('font/') && file.type !== format.mime) fail('The file contents do not match its declared type.');
  if (file.size > format.max * 1024 * 1024) fail(`Choose a file under ${format.max} MB.`, 413);
  let dimensions = {};
  if (format.mime.startsWith('image/')) {
    try { const {width, height} = imageSize(buffer); dimensions = {width, height}; } catch { fail('This image is damaged.'); }
    const {width, height} = dimensions;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 32000000) fail('Choose an image with at most 32 million pixels and a maximum side of 16,384 pixels.');
  }
  if (panorama && (!dimensions.width || Math.abs(dimensions.width / dimensions.height - 2) > 0.04)) fail('A tour needs a 2:1 panoramic image.');
  if (format.mime.startsWith('font/')) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (buffer.length < (detected.ext === 'woff2' ? 48 : 44) || view.getUint32(8) !== file.size || view.getUint32(16) > 16 * 1024 * 1024) fail('This font file is damaged or too large when expanded.');
  }
  return {file, mime: format.mime, name: file.name, size: file.size, panorama, ...dimensions};
}
