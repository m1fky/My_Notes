import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 132,
          background:
            "linear-gradient(140deg, rgba(125,211,252,1) 0%, rgba(37,99,235,1) 45%, rgba(251,113,133,1) 100%)",
        }}
      >
        <div
          style={{
            width: 384,
            height: 384,
            borderRadius: 108,
            border: "1.5px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.14)",
            boxShadow: "0 24px 60px rgba(5, 9, 18, 0.28)",
            display: "flex",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.2), rgba(255,255,255,0.04))",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 62,
              left: 64,
              width: 220,
              height: 36,
              borderRadius: 18,
              background: "rgba(255,255,255,0.9)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 128,
              left: 64,
              width: 176,
              height: 28,
              borderRadius: 14,
              background: "rgba(255,255,255,0.58)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 182,
              left: 64,
              width: 140,
              height: 28,
              borderRadius: 14,
              background: "rgba(255,255,255,0.42)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 36,
              bottom: 38,
              width: 132,
              height: 162,
              borderRadius: 46,
              background:
                "radial-gradient(circle at 35% 10%, rgba(253,242,248,1), rgba(125,211,252,1) 56%, rgba(37,99,235,1) 100%)",
              boxShadow: "0 18px 40px rgba(5, 9, 18, 0.24)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 82,
              bottom: 84,
              width: 52,
              height: 82,
              borderRadius: 24,
              background: "rgba(255,255,255,0.92)",
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
