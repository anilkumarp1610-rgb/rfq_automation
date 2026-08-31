import path from 'node:path';
import multer from 'multer';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

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
