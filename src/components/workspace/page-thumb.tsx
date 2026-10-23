"use client";
import { memo } from "react";
import type { PageDto } from "@/lib/client/api";

/** Cheap SVG preview of a page (no canvas): ink as polylines, other objects as faint boxes. */
export const PageThumb = memo(function PageThumb({ page, transparent = false }: { page: PageDto; transparent?: boolean }) {
  const { width: w, height: h } = page;
  const bg = page.pageType === "GRID" ? "url(#grid)" : "#fff";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block h-full w-full" aria-hidden>
      <defs>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="#dfe5f2" strokeWidth="2" />
        </pattern>
        <pattern id="ruled" width="10" height="64" patternUnits="userSpaceOnUse">
          <path d="M0 63H10" stroke="#cfd8ee" strokeWidth="2" />
        </pattern>
      </defs>
      {!transparent && <rect width={w} height={h} fill="#fff" />}
      {page.pageType === "GRID" && <rect width={w} height={h} fill={bg} />}
      {page.pageType === "RULED" && <rect width={w} height={h} fill="url(#ruled)" />}
      {page.objects.map((o) => {
        if (o.type === "INK") {
          const pts: string[] = [];
          for (let i = 0; i + 1 < o.data.points.length; i += 2) pts.push(`${(o.x + o.data.points[i]!).toFixed(0)},${(o.y + o.data.points[i + 1]!).toFixed(0)}`);
          return (
            <polyline
              key={o.id}
              points={pts.join(" ")}
              fill="none"
              stroke={o.data.color}
              strokeOpacity={o.data.opacity}
              strokeWidth={Math.max(o.data.size, 6)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        if (o.type === "TEXT" || o.type === "EQUATION")
          return <rect key={o.id} x={o.x} y={o.y} width={o.width} height={Math.max(o.height, 16)} fill={o.data.color} opacity={0.35} rx={4} />;
        if (o.type === "SHAPE")
          return <rect key={o.id} x={o.x} y={o.y} width={o.width} height={o.height} fill="none" stroke={o.data.stroke} strokeWidth={6} rx={o.data.shape === "ellipse" ? Math.min(o.width, o.height) / 2 : 0} />;
        return <rect key={o.id} x={o.x} y={o.y} width={o.width} height={o.height} fill="#3b5bdb" opacity={0.15} />;
      })}
    </svg>
  );
});
