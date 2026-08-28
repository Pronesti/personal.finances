"use client";
import { useSyncExternalStore } from "react";
import { chartTheme, type ChartTheme, type Scheme } from "@/lib/colors";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getScheme = (): Scheme => (window.matchMedia(QUERY).matches ? "dark" : "light");
// The server cannot know the reader's scheme. Light is the guess; useSyncExternalStore
// re-renders on the client during hydration, so a dark reader sees the dark ramp before
// paint rather than a flash of the light one.
const getServerScheme = (): Scheme => "light";

/** The colours a recharts chart should draw with, tracking the OS scheme live. */
export function useChartTheme(): ChartTheme {
  return chartTheme(useSyncExternalStore(subscribe, getScheme, getServerScheme));
}

/** Shared axis chrome — recharts' defaults are a hardcoded #666 that dies on a dark canvas. */
export function axisProps(t: ChartTheme) {
  return {
    tick: { fill: t.inkMuted, fontSize: 12 },
    axisLine: { stroke: t.grid },
    tickLine: { stroke: t.grid },
  } as const;
}

/** Shared tooltip card — recharts' default is an opaque white box, unreadable in dark mode. */
export function tooltipProps(t: ChartTheme) {
  return {
    contentStyle: {
      background: t.surface,
      border: `1px solid ${t.line}`,
      borderRadius: 8,
      color: t.ink,
      fontSize: 12,
      boxShadow: "0 4px 16px rgb(0 0 0 / 0.12)",
    },
    labelStyle: { color: t.inkMuted },
    itemStyle: { color: t.ink },
    cursor: { fill: t.grid, fillOpacity: 0.35, stroke: t.line },
  } as const;
}

export function legendProps(t: ChartTheme) {
  return { wrapperStyle: { color: t.inkMuted, fontSize: 12 } } as const;
}

export function gridProps(t: ChartTheme) {
  return { stroke: t.grid, strokeDasharray: "3 3", vertical: false } as const;
}

/**
 * Recharts derives a bar's width from the distance between category ticks, which is zero when a
 * chart holds a single point — exactly what the "all" granularity produces. Without an explicit
 * width those bars are laid out 0px wide and the chart reads as empty. Spread onto every `<Bar>`
 * whose x axis is a period.
 */
export function barWidth(points: number) {
  return points < 2 ? ({ barSize: 120 } as const) : ({} as const);
}
