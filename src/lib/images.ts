/** Longest edge kept when shrinking a photo. Small print survives this. */
export const MAX_EDGE = 1600;

/** JPEG quality for the shrunk copy: readable text, a fraction of the bytes. */
const QUALITY = 0.82;

export interface ShrunkImage {
  /** base64 with no data: prefix, ready to send */
  base64: string;
  mimeType: string;
}

/** Reads a file as base64 without touching it. */
function readAsIs(file: File): Promise<ShrunkImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        base64: String(reader.result).split(",")[1] ?? "",
        mimeType: file.type || "image/jpeg",
      });
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Shrinks a photo in the browser before it is sent anywhere.
 *
 * Worth doing twice over: a phone photo is several megabytes, and a vision
 * model is billed by how many tiles the image covers, so the full-resolution
 * original costs more and reads no better.
 *
 * Falls back to the original bytes when the browser cannot decode the format —
 * Safari hands over HEIC that canvas will not draw. An undecodable photo is
 * still worth sending rather than becoming an error nobody can act on.
 */
export async function shrinkImage(file: File): Promise<ShrunkImage> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return readAsIs(file);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const base64 = canvas.toDataURL("image/jpeg", QUALITY).split(",")[1] ?? "";
    if (!base64) return readAsIs(file);
    return { base64, mimeType: "image/jpeg" };
  } catch {
    return readAsIs(file);
  }
}
