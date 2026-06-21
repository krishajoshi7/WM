import jwt from "jsonwebtoken";
import QRCode from "qrcode";

export type WasteQrClaims = {
  batch_id: string;
  batch_code: string;
  generator_id: string;
  created_at: string;
  type: "waste_qr";
};

// This JWT is the tamper-evident server-side proof for a batch.
// It is not printed into the QR because full JWTs are too dense for field scans.
export function signWasteQr(claims: WasteQrClaims) {
  return jwt.sign(claims, getJwtSecret(), {
    expiresIn: "730d",
    issuer: "sustainable-ecg",
    audience: "waste-custody"
  });
}

// Scans resolve a short QR identifier to a batch first, then verify this stored JWT.
export function verifyWasteQr(token: string) {
  const decoded = jwt.verify(token, getJwtSecret(), {
    issuer: "sustainable-ecg",
    audience: "waste-custody"
  });

  if (typeof decoded === "string" || decoded.type !== "waste_qr") {
    throw new Error("QR payload is not a Sustainable ECG waste token");
  }

  return decoded as WasteQrClaims & jwt.JwtPayload;
}

function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV !== "production") {
    return "development-only-sustainable-ecg-secret";
  }

  throw new Error("JWT_SECRET is required for QR signing");
}

export function normalizeScannedQr(value: string) {
  return value.trim();
}

// The printed QR stays short and high-contrast; full batch details are fetched after scan.
export async function renderQrDataUrl(identifier: string) {
  return QRCode.toDataURL(identifier, {
    errorCorrectionLevel: "M",
    margin: 4,
    scale: 10,
    color: {
      dark: "#111827",
      light: "#ffffff"
    }
  });
}
