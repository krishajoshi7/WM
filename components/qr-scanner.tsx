"use client";

import { Camera, Keyboard, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function QrScanner({
  onScan,
  title
}: {
  title: string;
  onScan: (value: string) => void;
}) {
  const scannerId = useRef(`qr-reader-${Math.random().toString(36).slice(2)}`);

  // Camera scanners can emit the same decoded value several times per second.
  // Suppressing repeats avoids accidental duplicate custody events.
  const lastScanRef = useRef("");
  const [manualToken, setManualToken] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [scanHint, setScanHint] = useState("Point the camera at a clean Sustainable ECG QR label.");

  useEffect(() => {
    let scanner: { render: Function; clear: Function } | null = null;
    let cancelled = false;

    async function startScanner() {
      try {
        // html5-qrcode touches browser APIs, so load it only on the client.
        const { Html5QrcodeScanner } = await import("html5-qrcode");
        if (cancelled) {
          return;
        }
        scanner = new Html5QrcodeScanner(
          scannerId.current,
          { fps: 10, qrbox: { width: 240, height: 240 } },
          false
        );
        scanner.render(
          (decodedText: string) => {
            const value = decodedText.trim();

            if (!value || value === lastScanRef.current) {
              return;
            }

            lastScanRef.current = value;
            setScanHint("QR detected. Fetching batch details...");
            onScan(value);
          },
          (scanError: string) => {
            // NotFoundException is the normal "no QR in frame yet" state.
            if (scanError.includes("NotFoundException")) {
              setScanHint("No QR detected yet. Hold the label flat with good light.");
              return;
            }

            setScanHint("Scanner is active. Try centering the QR inside the frame.");
          }
        );
      } catch (error) {
        setCameraError("Camera scanner unavailable. You can enter the short batch code manually.");
      }
    }

    startScanner();

    return () => {
      cancelled = true;
      scanner?.clear?.();
    };
  }, [onScan]);

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-operational">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-black">{title}</h3>
        <Camera className="h-5 w-5 text-primary" />
      </div>
      <div id={scannerId.current} className="overflow-hidden rounded-md border border-border bg-muted" />
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <ScanLine className="h-4 w-4" />
        {scanHint}
      </p>
      {cameraError ? (
        <p className="mt-2 text-sm font-bold text-destructive">{cameraError}</p>
      ) : null}
      <div className="mt-4 grid gap-2">
        <label className="text-sm font-bold text-muted-foreground" htmlFor={`${scannerId.current}-manual`}>
          Manual batch code or token
        </label>
        <textarea
          id={`${scannerId.current}-manual`}
          className="min-h-24 rounded-md border border-input bg-background p-3 text-sm"
          onChange={(event) => setManualToken(event.target.value)}
          value={manualToken}
        />
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground"
          onClick={() => {
            const value = manualToken.trim();

            if (!value) {
              setScanHint("Enter a batch code such as WM-2026-00125.");
              return;
            }

            onScan(value);
          }}
          type="button"
        >
          <Keyboard className="h-4 w-4" />
          Use token
        </button>
      </div>
    </section>
  );
}
