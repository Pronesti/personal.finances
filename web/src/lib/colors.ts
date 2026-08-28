import type { Category } from "@/lib/categorize";

// Chart marks are the one place a colour cannot come from a CSS variable: recharts writes
// fill/stroke as SVG attributes at render time, so it needs a concrete string. Hence two
// hand-tuned ramps instead of one — a hue that reads on white is muddy on near-black, and
// vice versa. Both ramps clear 3:1 against their scheme's --canvas (WCAG non-text contrast).
export type Scheme = "light" | "dark";

const CATEGORY_LIGHT: Record<Category, string> = {
  food: "#1f9254", transport: "#0b7fbb", subscriptions: "#7c4dcc", health: "#d43f4f",
  entertainment: "#cf7211", shopping: "#c8459a", services: "#10897f", travel: "#4d5bd0",
  education: "#6b8f19", taxes_fees: "#6b7280", transfers: "#8a90a0", other: "#8f95a3",
};

const CATEGORY_DARK: Record<Category, string> = {
  food: "#3fcf82", transport: "#45b6f5", subscriptions: "#a98bff", health: "#ff7b8a",
  entertainment: "#f5b13c", shopping: "#ff7ac4", services: "#35d4c2", travel: "#8a97ff",
  education: "#b3d94a", taxes_fees: "#9aa3b2", transfers: "#7d8695", other: "#737c8a",
};

export type ChartTheme = {
  scheme: Scheme;
  category: Record<Category, string>;
  /**
   * Series colours for charts that are not split by category. `mixed` is for a mark that spans
   * every category at once — a card in the sankey, which funds all of them — so it has to read
   * as structure rather than as one more category: darker than the three greyish category hues
   * (transfers, taxes_fees, other), and still clearing 3:1 on canvas and on a card surface.
   */
  series: { primary: string; secondary: string; band: string; alert: string; neutral: string; mixed: string };
  /** Chrome: axis labels, gridlines, the tooltip card. */
  ink: string;
  inkMuted: string;
  grid: string;
  surface: string;
  line: string;
};

const LIGHT: ChartTheme = {
  scheme: "light",
  category: CATEGORY_LIGHT,
  series: { primary: "#0b7fbb", secondary: "#7c4dcc", band: "#cf7211", alert: "#d43f4f", neutral: "#6b7280", mixed: "#4b5262" },
  ink: "#14161a",
  inkMuted: "#5a6371",
  grid: "#e3e6eb",
  surface: "#ffffff",
  line: "#c8ced8",
};

const DARK: ChartTheme = {
  scheme: "dark",
  category: CATEGORY_DARK,
  series: { primary: "#45b6f5", secondary: "#a98bff", band: "#f5b13c", alert: "#ff7b8a", neutral: "#9aa3b2", mixed: "#646c7a" },
  ink: "#e8eaee",
  inkMuted: "#a2abba",
  grid: "#272c36",
  surface: "#161920",
  line: "#39404d",
};

export const CHART_THEMES: Record<Scheme, ChartTheme> = { light: LIGHT, dark: DARK };

export function chartTheme(scheme: Scheme): ChartTheme {
  return CHART_THEMES[scheme];
}
