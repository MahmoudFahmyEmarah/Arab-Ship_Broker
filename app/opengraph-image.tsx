import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Arab ShipBroker — Connecting shippers with shipowners";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  // ImageResponse cannot resolve Next's generated /_next/static/... URL while
  // this route is prerendered. Embedding the existing logo makes the image
  // self-contained and avoids a build-time network request.
  const logo = await readFile(join(process.cwd(), "public", "logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "72px 84px",
          background: "linear-gradient(135deg, #f8fbfd 0%, #e7f3f8 100%)",
          color: "#082f49",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            width: 310,
            height: 310,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 48,
            background: "#ffffff",
            boxShadow: "0 24px 70px rgba(8, 47, 73, 0.12)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt=""
            width={270}
            height={270}
            style={{ objectFit: "contain" }}
          />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: 72,
            maxWidth: 650,
          }}
        >
          <div
            style={{
              color: "#0284a8",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            MENA Maritime Brokerage
          </div>
          <div
            style={{
              marginTop: 22,
              fontSize: 58,
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: -2,
            }}
          >
            Arab ShipBroker
          </div>
          <div
            style={{
              marginTop: 30,
              fontSize: 34,
              lineHeight: 1.3,
              color: "#334e68",
            }}
          >
            Connecting shippers with shipowners
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: 42,
              color: "#0369a1",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            arabshipbroker.com
          </div>
        </div>
      </div>
    ),
    size,
  );
}
