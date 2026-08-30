import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { CHROME } from "@/lib/chrome";
import { DICTIONARIES, DEFAULT_LOCALE } from "@/lib/i18n";

const APP = path.resolve(__dirname, "../app");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

const PAGES = pageFiles(APP).map(file => {
  const dir = path.dirname(path.relative(APP, file));
  return { route: dir === "." ? "/" : `/${dir}`, src: readFileSync(file, "utf8") };
});

describe("route chrome", () => {
  it("finds the routes", () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(20);
  });

  // A page with no row renders no header at all, and a row with no page is dead weight. Making
  // this an equality is the whole point of the table: adding a route without deciding what its
  // header holds fails here rather than shipping a page with no title.
  it("has exactly one entry per route", () => {
    expect(Object.keys(CHROME).sort()).toEqual(PAGES.map(p => p.route).sort());
  });

  // The header is the layout's, not the page's. A page that renders its own title puts it
  // wherever its own markup lands, which is the bug this table exists to make impossible.
  it("leaves the header entirely to the layout", () => {
    for (const { route, src } of PAGES) {
      expect(src, route).not.toContain("<h1");
      expect(src, route).not.toContain("<ModeToggle");
    }
  });

  it("names a title key that exists", () => {
    for (const [route, entry] of Object.entries(CHROME)) {
      expect(Object.keys(DICTIONARIES[DEFAULT_LOCALE]), route).toContain(entry.title);
    }
  });
});
