import {z} from 'zod';
import {mediaId} from './media.mjs';
const txt = (n = 250) => z.string().trim().max(n).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, 'Remove control characters.');
const httpsUrl = v => {
  if (!v) return true;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !/[\s\\]/.test(v); } catch { return false; }
};
const link = txt(1000).refine(httpsUrl, 'Use a valid HTTPS address.');
const asset = txt(1000).refine(v => !v || !!mediaId(v) || /^\/images\/[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg)$/.test(v) || httpsUrl(v), 'Use an uploaded file or a valid HTTPS image address.');
const uploaded = txt(100).refine(v => !!mediaId(v), 'Upload the file first.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T00:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; }, 'Choose a valid calendar date.');
const common = {title: txt(160).min(1, 'A title is required.'), published: z.boolean().default(false), order: z.number().int().min(0).max(10000).default(0)};
export const schemas = {
  services: z.object({...common, category: txt(50).min(1), description: txt(2000), price: z.number().finite().min(0).max(1e7).nullable().default(null), duration: txt(100), image: asset.default('')}),
  gallery: z.object({...common, category: txt(50), description: txt(1500), url: uploaded, mediaType: z.enum(['image', 'video']), consent: z.boolean()}).refine(v => !v.published || v.consent, 'Confirm client permission before publishing.'),
  tours: z.object({...common, url: uploaded, description: txt(1500), initialYaw: z.number().min(-180).max(180).default(0)}),
  team: z.object({...common, role: txt(100), description: txt(1500), image: asset.default('')}),
  testimonials: z.object({...common, description: txt(1500).min(1), service: txt(100), consent: z.boolean()}).refine(v => !v.published || v.consent, 'Confirm permission before publishing this review.'),
  faqs: z.object({...common, description: txt(3000).min(1)}),
  offers: z.object({...common, description: txt(1500), endDate: date.or(z.literal('')), image: asset.default('')}),
};
export const settingsSchema = z.object({name: txt(100).min(1), tagline: txt(150), heroTitle: txt(150).min(1), heroDescription: txt(1000), heroImage: asset, heroImageEditorial: z.boolean(), studioImage: asset, studioImageEditorial: z.boolean(), about: txt(3000), phone: txt(50), whatsapp: txt(30).refine(v => !v || /^\+?[0-9 ]{10,18}$/.test(v), 'Use country code and digits for WhatsApp.'), email: z.string().email().max(200).or(z.literal('')), address: txt(600), mapUrl: link, instagram: link, facebook: link, hours: txt(600), announcement: txt(250), fontUrl: uploaded.or(z.literal('')), bookingEnabled: z.boolean(), privacy: txt(6000), bookingNote: txt(1000)});
export const bookingSchema = z.object({name: txt(100).min(2), phone: txt(30).regex(/^\+?[0-9 ()-]{9,25}$/, 'Enter a valid phone number.'), email: z.string().email().max(200).or(z.literal('')).default(''), serviceId: txt(100).regex(/^[a-zA-Z0-9_-]+$/), date, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), notes: txt(1500).default(''), consent: z.literal(true), website: z.string().max(0).optional(), requestId: z.string().uuid()});
export const accountSchema = z.object({email: z.string().trim().email().max(200).transform(v => v.toLowerCase()), password: z.string().min(15, 'Use at least 15 characters.').max(128)});
export const loginSchema = z.object({email: z.string().trim().email().max(200).transform(v => v.toLowerCase()), password: z.string().min(1).max(128), code: z.string().max(40).optional()});
export function parse(schema, value) { const result = schema.safeParse(value); if (!result.success) throw Object.assign(new Error(result.error.issues[0]?.message || 'Please check the form.'), {status: 400}); return result.data; }
