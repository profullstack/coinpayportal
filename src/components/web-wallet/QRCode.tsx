'use client';

import { useEffect, useRef, useState } from 'react';
import QRCodeLib from 'qrcode';

interface QRCodeProps {
  /** The data to encode in the QR code */
  value: string;
  /** Size in pixels (default: 200) */
  size?: number;
  /** Label text below the QR code */
  label?: string;
}

export function QRCode({ value, size = 200, label }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !value) return;
    setError(false);

    QRCodeLib.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    }).catch(() => {
      setError(true);
    });
  }, [value, size]);

  if (!value) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-white"
        style={{ width: size, height: size }}
        role="img"
        aria-label="QR code placeholder"
      >
        <p className="text-xs text-gray-400">No address</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-white"
        style={{ width: size, height: size }}
        role="img"
        aria-label="QR code error"
      >
        <p className="text-xs text-red-500">Failed to generate QR</p>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="rounded-lg bg-white p-2">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`QR code for ${label || value}`}
        />
      </div>
      {label && (
        <p className="text-xs text-gray-400">{label}</p>
      )}
    </div>
  );
}
