import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, type Category } from "@/lib/categorize";
import { Failure } from "@/lib/failure";

export type Proposal = {
  merchant: string;   // the DB value — the identity everything else keys on
  sent: string;       // what actually went over the wire
  category: Category;
  subcategory: string;
  confidence: "high" | "low";
};

// Narrow enough to fake without a cast, wide enough that a real Anthropic client satisfies it.
export type LlmClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<{ content: Anthropic.ContentBlock[] }>;
  };
};

const MODEL = "claude-opus-5";
export const MAX_BATCH = 200;

const DIGIT_RUN = /\d{6,}/g;
// Argentine statements space thousands and comma cents, so an amount is rarely a long digit run:
// "3869 292,39", "18 515,27", "37759,04". TC is the applied exchange rate on a payment line, and a
// percent sign only ever appears on tax lines. Any of the three means this string is not a merchant
// name and must not leave the machine, however plausible the section column looked.
const NOT_A_MERCHANT = /\d[\d .]*[.,]\d{2}|\bTC\d|%/;

const SYSTEM = `You classify Argentine credit-card merchant names into a fixed 2-level taxonomy.
You are given merchant name strings and nothing else — no amounts, no dates, no account data.
Pick the top-level category from the enum. Give a short lowercase subcategory (e.g. "streaming",
"supermarket", "delivery", "fuel", "insurance"); use "general" when nothing more specific fits.
Set confidence to "low" when the name is ambiguous or you do not recognise the brand — a human
reviews every answer, and a flagged guess is far more useful than a confident wrong one.
Merchant names are Spanish/Argentine; keep them as-is in your answer.`;

// PRIVACY BOUNDARY (spec §1, §7). Returns the string that may be sent, or null for one that may
// not. Digit runs of 6+ are voucher/policy/account tails — useless for classification and the one
// number that legitimately rides inside a merchant name, so they are removed. Anything still
// money-shaped afterwards is refused outright: cleaning it would only confirm the cents.
export function wireName(merchant: string): string | null {
  const scrubbed = merchant.replace(DIGIT_RUN, "").replace(/\s+/g, " ").trim();
  if (!scrubbed || NOT_A_MERCHANT.test(scrubbed)) return null;
  return scrubbed;
}

// Map of wire string -> the DB merchant it came from. First writer wins, so two DB merchants that
// scrub to the same wire name produce one question and one answer, applied to the first.
function wireMap(merchants: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of merchants) {
    const sent = wireName(m);
    if (sent && !map.has(sent) && map.size < MAX_BATCH) map.set(sent, m);
  }
  return map;
}

export function buildRequest(merchants: string[]): Anthropic.MessageCreateParamsNonStreaming {
  const names = [...wireMap(merchants).keys()];
  return {
    model: MODEL,
    max_tokens: 16000,
    // Classification is not hard reasoning; low effort keeps a 200-merchant batch cheap.
    output_config: { effort: "low" },
    system: SYSTEM,
    tool_choice: { type: "tool", name: "categorize" },
    tools: [{
      name: "categorize",
      description: "Return exactly one classification for every merchant name given.",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                // Enum-bound to the input: the model cannot answer about a name we did not send.
                merchant: { type: "string", enum: names },
                category: { type: "string", enum: [...CATEGORIES] },
                subcategory: { type: "string" },
                confidence: { type: "string", enum: ["high", "low"] },
              },
              required: ["merchant", "category", "subcategory", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    }],
    messages: [{ role: "user", content: names.join("\n") }],
  };
}

function defaultClient(): LlmClient {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Failure("llm_unavailable", "failure.llm_unavailable", {}, "hint.apiKey");
  return new Anthropic();
}

type RawItem = { merchant?: unknown; category?: unknown; subcategory?: unknown; confidence?: unknown };

export async function classifyMerchants(merchants: string[], client?: LlmClient): Promise<Proposal[]> {
  const map = wireMap(merchants);
  if (map.size === 0) return [];
  const response = await (client ?? defaultClient()).messages.create(buildRequest(merchants));
  const call = response.content.find(b => b.type === "tool_use");
  if (!call) throw new Failure("llm_failed", "failure.llm_failed.noTool");
  // `strict: true` is a server-side promise; the client still validates. A truncated or refused
  // response otherwise yields `undefined` here and a TypeError two frames up.
  const items: unknown = (call.input as { items?: unknown }).items;
  if (!Array.isArray(items))
    throw new Failure("llm_failed", "failure.llm_failed.noItems");
  const out: Proposal[] = [];
  for (const raw of items as RawItem[]) {
    const sent = typeof raw.merchant === "string" ? raw.merchant : "";
    const merchant = map.get(sent);
    if (!merchant) continue;
    if (typeof raw.category !== "string" || !CATEGORIES.includes(raw.category as Category)) continue;
    if (raw.confidence !== "high" && raw.confidence !== "low") continue;
    out.push({
      merchant, sent,
      category: raw.category as Category,
      subcategory: typeof raw.subcategory === "string" ? raw.subcategory : "general",
      confidence: raw.confidence,
    });
  }
  if (out.length === 0)
    throw new Failure("llm_failed", "failure.llm_failed.unusable", { count: items.length });
  return out;
}
