import { v2 as cloudinary } from "cloudinary";
import { addWhatsAppMediaAsset, whatsappMediaAssets } from "./db.js";

export function cloudinaryStatus() {
  return {
    configured: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
  };
}

export async function listWhatsAppMedia() {
  return whatsappMediaAssets();
}

export async function uploadWhatsAppMedia({ file, userId }) {
  configureCloudinary();
  if (!file?.buffer?.length) throw new Error("Image file is required.");
  if (!file.contentType?.startsWith("image/")) throw new Error("Only image uploads are allowed.");
  if (file.buffer.length > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller.");

  const uploaded = await uploadBuffer(file.buffer, {
    folder: process.env.CLOUDINARY_WHATSAPP_FOLDER || "nandd-mahal/whatsapp-headers",
    resource_type: "image",
    use_filename: true,
    unique_filename: true
  });

  return addWhatsAppMediaAsset({
    name: file.filename || uploaded.original_filename || uploaded.public_id,
    provider: "cloudinary",
    publicId: uploaded.public_id,
    url: uploaded.url,
    secureUrl: uploaded.secure_url,
    format: uploaded.format,
    bytes: uploaded.bytes,
    width: uploaded.width,
    height: uploaded.height,
    uploadedByUserId: userId
  });
}

function configureCloudinary() {
  if (!cloudinaryStatus().configured) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(buffer);
  });
}
