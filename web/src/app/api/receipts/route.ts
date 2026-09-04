import { getDb } from "@/lib/db";
import { ingestReceipt, ReceiptRejected } from "@/lib/receipts/ingest";
import { Failure } from "@/lib/failure";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";

export async function POST(request: Request): Promise<Response> {
  const locale = await getLocale();
  const file = (await request.formData()).get("file");
  if (!(file instanceof File))
    return Response.json({ code: "bad_name", message: translate(locale, "failure.noFile") }, { status: 400 });
  try {
    // file.name is deliberately not passed: nothing about a receipt is in its file name.
    return Response.json(await ingestReceipt(getDb(), Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    if (e instanceof ReceiptRejected)
      return Response.json(
        { code: "verification_failed", message: translate(locale, "receipts.rejected"), ...e.payload }, { status: 422 },
      );
    if (e instanceof Failure)
      return Response.json({ code: e.code, ...e.localized(locale) }, { status: 400 });
    // Never rethrow: Next would answer with an HTML 500 that the drop zone cannot parse.
    return Response.json({ code: "ingest_failed", message: (e as Error).message }, { status: 500 });
  }
}
