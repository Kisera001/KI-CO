export function captureVideoFrame(video: HTMLVideoElement, quality = 0.78): string {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Video metadata is not ready yet.");
  }

  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available.");
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function captureVideoThumbnail(video: HTMLVideoElement, quality = 0.7): string {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Video metadata is not ready yet.");
  }

  const maxWidth = 420;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available.");
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
