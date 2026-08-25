import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type Anthropic from "@anthropic-ai/sdk";
import { DATA_DIR } from "@/lib/paths";
import { MAX_BATCH, wireName, buildRequest, classifyMerchants, type LlmClient } from "@/lib/llm";
import { Failure } from "@/lib/failure";

describe("wireName", () => {
  it("strips voucher and policy digit tails", () => {
    expect(wireName("OSDE 000012345678901")).toBe("OSDE");
    expect(wireName("RENTALTOLL471928174")).toBe("RENTALTOLL");
  });
  it("keeps short digits that are part of the brand", () => {
    expect(wireName("CARREFOUR 24")).toBe("CARREFOUR 24");
  });
  it("refuses to send anything money-shaped rather than trying to clean it", () => {
    expect(wireName("SU PAGO EN PESOS 3869 292,39 TC1510,000")).toBeNull();
    expect(wireName("IVA RG 4240 21%( 37759,04)")).toBeNull();
    expect(wireName("DB IVA $ 21% 18 515,27")).toBeNull();
    expect(wireName("IIBB PERCEP-CABA 2,00%( 195890,18)")).toBeNull();
  });
});

type ToolShape = {
  input_schema: { properties: { items: { items: { properties: Record<string, { enum?: string[] }> } } } };
};

describe("buildRequest — privacy boundary", () => {
  const merchants = ["SPOTIFY", "OSDE 000012345678901", "SPOTIFY", "LA PANADERIA"];

  it("sends the scrubbed, deduplicated merchant strings and nothing else", () => {
    const wire = JSON.stringify(buildRequest(merchants));
    for (const secret of ["JUAN PEREZ", "4517550000000000", "2026-07-30", "3864892,39"])
      expect(wire).not.toContain(secret);
    expect(wire).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(wire).toContain("SPOTIFY");
    expect(wire).toContain("LA PANADERIA");
  });

  it("constrains the model to the merchants it was given and the app's own categories", () => {
    const tool = buildRequest(merchants).tools![0] as unknown as ToolShape;
    const props = tool.input_schema.properties.items.items.properties;
    expect(props.merchant.enum).toEqual(["SPOTIFY", "OSDE", "LA PANADERIA"]);
    expect(props.category.enum).toContain("food");
    expect(props.category.enum).not.toContain("crypto");
  });

  it("uses claude-opus-5", () => {
    expect(buildRequest(merchants).model).toBe("claude-opus-5");
  });

  // The boundary's input is user data, so the boundary's test has to be user data too.
  it("sends no amount from ANY merchant in the real database", () => {
    const dbPath = path.join(DATA_DIR, "app.db");
    if (!fs.existsSync(dbPath)) return; // fresh clone: nothing to check
    const db = new Database(dbPath, { readonly: true });
    const all = (db.prepare("SELECT DISTINCT merchant FROM transactions").all() as { merchant: string }[])
      .map(r => r.merchant);
    db.close();
    expect(all.length).toBeGreaterThan(100);
    const wire = JSON.stringify(buildRequest(all));
    expect(wire).not.toMatch(/\d[\d .]*[.,]\d{2}/); // no money, however it is spaced
    expect(wire).not.toMatch(/\bTC\d/);             // no applied exchange rate
    expect(wire).not.toMatch(/\d{6,}/);             // no account, policy or voucher number
  });

  it("caps a runaway batch", () => {
    const many = Array.from({ length: 500 }, (_, i) => `MERCHANT ${String.fromCharCode(65 + (i % 26))}${i}`);
    const tool = buildRequest(many).tools![0] as unknown as ToolShape;
    expect(tool.input_schema.properties.items.items.properties.merchant.enum!.length).toBe(MAX_BATCH);
  });
});

describe("classifyMerchants", () => {
  const fake = (content: Anthropic.ContentBlock[]): LlmClient =>
    ({ messages: { create: async () => ({ content }) } });

  const toolUse = (items: unknown): Anthropic.ContentBlock[] =>
    [{ type: "tool_use", id: "t1", name: "categorize", input: { items } } as Anthropic.ContentBlock];

  it("returns proposals keyed by the DB merchant, not the wire string", async () => {
    const client = fake(toolUse([
      { merchant: "OSDE", category: "health", subcategory: "insurance", confidence: "high" },
    ]));
    await expect(classifyMerchants(["OSDE 000012345678901"], client)).resolves.toEqual([
      { merchant: "OSDE 000012345678901", sent: "OSDE", category: "health", subcategory: "insurance", confidence: "high" },
    ]);
  });

  it("drops an item naming a merchant that was never sent", async () => {
    const client = fake(toolUse([
      { merchant: "SOMETHING ELSE", category: "food", subcategory: "x", confidence: "high" },
    ]));
    await expect(classifyMerchants(["SPOTIFY"], client)).rejects.toBeInstanceOf(Failure);
  });

  it("drops an item with a category the app does not have", async () => {
    const client = fake(toolUse([
      { merchant: "SPOTIFY", category: "crypto", subcategory: "x", confidence: "high" },
      { merchant: "SPOTIFY", category: "subscriptions", subcategory: "music", confidence: "high" },
    ]));
    const out = await classifyMerchants(["SPOTIFY"], client);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("subscriptions");
  });

  it("fails loudly when the model answered without calling the tool", async () => {
    const text = [{ type: "text", text: "not sure", citations: null } as Anthropic.ContentBlock];
    await expect(classifyMerchants(["SPOTIFY"], fake(text))).rejects.toBeInstanceOf(Failure);
  });

  it("fails loudly when the answer has no items array", async () => {
    await expect(classifyMerchants(["SPOTIFY"], fake(toolUse(undefined)))).rejects.toBeInstanceOf(Failure);
  });

  it("does not call the API when nothing is sendable", async () => {
    let calls = 0;
    const client: LlmClient = { messages: { create: async () => { calls++; return { content: [] }; } } };
    await expect(classifyMerchants(["IVA RG 4240 21%( 37759,04)"], client)).resolves.toEqual([]);
    expect(calls).toBe(0);
  });
});
