import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

/** Drawing storage. Override with `UPLOAD_DIR` (the test suite points it at a temp folder). */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // a fresh checkout / CI has no uploads folder yet

const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Multer for drawing uploads — PDF or image, 32 MB, saved to `uploads/`. */
export const drawingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 32 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ACCEPTED.includes(file.mimetype)),
});

/** Internal test folder: drawings uploaded just to try the extraction, not attached to any RFQ. */
export const TEST_DRAWINGS_DIR = path.join(UPLOAD_DIR, 'test-drawings');
fs.mkdirSync(TEST_DRAWINGS_DIR, { recursive: true });

/** A safe on-disk name: no folders, no odd characters, never overwrites an existing file. */
export function uniqueTestName(original: string): string {
  const base = path.basename(original).replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').replace(/ +/g, '_') || 'drawing';
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length).slice(0, 120) || 'drawing';
  let name = `${stem}${ext}`;
  for (let n = 2; fs.existsSync(path.join(TEST_DRAWINGS_DIR, name)); n++) name = `${stem}-${n}${ext}`;
  return name;
}

export type RejectedFile = { name: string; reason: string };

/** Multer for the test folder: several files at once, original names kept (made safe + unique). */
export const testDrawingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEST_DRAWINGS_DIR),
    filename: (_req, file, cb) => cb(null, uniqueTestName(file.originalname)),
  }),
  limits: { fileSize: 32 * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    if (ACCEPTED.includes(file.mimetype)) return cb(null, true);
    const r = ((req as unknown as { rejected?: RejectedFile[] }).rejected ??= []);
    r.push({ name: file.originalname, reason: 'only PDF or image files (PNG, JPG, WEBP, GIF) are accepted' });
    cb(null, false);
  },
});
