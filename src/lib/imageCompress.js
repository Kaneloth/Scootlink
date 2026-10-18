// src/lib/imageCompress.js
//
// destination: src/lib/imageCompress.js
//
// Extracted from VerificationPanel.jsx, where it was defined locally
// (not previously a shared utility). Implementation copied exactly —
// canvas-based resize + JPEG compression to a base64 data URL, same
// defaults (1200px max dimension, 0.8 quality). Not modifying
// VerificationPanel.jsx itself; it can be pointed at this shared
// version later if you want to remove the duplicate.

export const compressImage = (file, maxPx = 1200, quality = 0.8) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
