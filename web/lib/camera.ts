export async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      // Más cuadros por segundo = menos desenfoque y más detecciones de SAM en objetos rápidos.
      frameRate: { ideal: 30, min: 24 },
    },
    audio: false,
  });
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function captureFrame(video: HTMLVideoElement, width = 640) {
  const height = Math.round((video.videoHeight * width) / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
  return { dataUrl, base64: dataUrl.split(",")[1], width, height };
}
