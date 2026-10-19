// Client-side upload prep: decode, apply EXIF orientation, downscale, re-encode.
// Keeps requests well under serverless body limits, and the OCR coordinate space
// matches exactly what the browser displays.

const MAX_EDGE = 2000;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export const ACCEPT_ATTR = ACCEPTED.join(",");

export interface PreparedImage {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

export async function prepareImage(file: Blob, name = "upload"): Promise<PreparedImage> {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error(`Unsupported file type ${file.type || "unknown"}. Use PNG, JPEG, or WebP.`);
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return { name, dataUrl: canvas.toDataURL("image/jpeg", 0.92), width, height };
}
