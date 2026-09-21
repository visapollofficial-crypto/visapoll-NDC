import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "../firebase/config";
import { compressImage } from "../utils/image";

export interface UploadedMedia {
  path: string;
  url: string;
  type: "image" | "video";
}

export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;
export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;

/** Validates on the client for fast feedback; Storage rules enforce the same limits server-side. */
export function validateMedia(file: File): string | null {
  if (file.type === "video/mp4") return file.size > MAX_VIDEO_BYTES ? "Videos must be under 24 MB." : null;
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) return file.size > MAX_IMAGE_INPUT_BYTES ? "Image is too large." : null;
  return "Only JPG, PNG, WebP images and MP4 videos are allowed.";
}

export async function uploadFeedMedia(uid: string, file: File, onProgress?: (p: number) => void): Promise<UploadedMedia> {
  const problem = validateMedia(file);
  if (problem) throw new Error(problem);
  const isVideo = file.type === "video/mp4";
  const body: Blob = isVideo ? file : await compressImage(file, 1280, 0.8);
  const path = `feedMedia/${uid}/${crypto.randomUUID()}.${isVideo ? "mp4" : "jpg"}`;
  const task = uploadBytesResumable(ref(storage, path), body, { contentType: isVideo ? "video/mp4" : "image/jpeg" });
  await new Promise<void>((resolve, reject) =>
    task.on("state_changed", (s) => onProgress?.(s.bytesTransferred / s.totalBytes), reject, () => resolve())
  );
  return { path, url: await getDownloadURL(task.snapshot.ref), type: isVideo ? "video" : "image" };
}

export async function uploadAvatar(uid: string, file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  const blob = await compressImage(file, 512, 0.8);
  const r = ref(storage, `profilePhotos/${uid}/avatar.jpg`);
  await uploadBytesResumable(r, blob, { contentType: "image/jpeg" });
  return getDownloadURL(r);
}

export interface Attachment {
  name: string;
  path: string;
  url: string;
  type: "pdf" | "image" | "video";
}

/** Admin-only (Storage rules enforce it). PDFs and MP4s go up as-is; images are compressed. */
export async function uploadClassFile(file: File): Promise<Attachment> {
  const isPdf = file.type === "application/pdf";
  const isVideo = file.type === "video/mp4";
  const isImage = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (!isPdf && !isVideo && !isImage) throw new Error("Use PDF, JPG, PNG, WebP or MP4 files.");
  if (file.size > 24 * 1024 * 1024) throw new Error("Files must be under 24 MB.");
  const body: Blob = isImage ? await compressImage(file, 1600, 0.85) : file;
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const path = `classMaterials/${crypto.randomUUID()}/${isImage ? safe.replace(/\.\w+$/, "") + ".jpg" : safe}`;
  const contentType = isPdf ? "application/pdf" : isVideo ? "video/mp4" : "image/jpeg";
  const r = ref(storage, path);
  await uploadBytesResumable(r, body, { contentType });
  return { name: file.name, path, url: await getDownloadURL(r), type: isPdf ? "pdf" : isVideo ? "video" : "image" };
}

/** Student ID photo for verification. Private folder; Storage rules make it write-only for the student. */
export async function uploadVerificationId(uid: string, file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Upload a clear photo (JPG, PNG or WebP) of your ID card.");
  const blob = await compressImage(file, 1600, 0.85);
  const path = `verification/${uid}/id-${crypto.randomUUID()}.jpg`;
  await uploadBytesResumable(ref(storage, path), blob, { contentType: "image/jpeg" });
  return path;
}

/** Homework photo: private folder; the server reads it once and deletes it. */
export async function uploadHomeworkImage(uid: string, file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG or WebP photo.");
  const blob = await compressImage(file, 1400, 0.85);
  const path = `homework/${uid}/${crypto.randomUUID()}.jpg`;
  await uploadBytesResumable(ref(storage, path), blob, { contentType: "image/jpeg" });
  return path;
}
