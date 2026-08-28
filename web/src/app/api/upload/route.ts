import { getDb } from "@/lib/db";
import { ingestUpload } from "@/lib/upload";
import { Failure } from "@/lib/failure";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";

export async function POST(request: Request): Promise<Response> {
  // The drop zone renders whatever this returns, so the reader's language is settled here — the
  // pipeline itself stays monolingual and throws keys.
  const locale = await getLocale();
  const file = (await request.formData()).get("file");
  if (!(file instanceof File))
    return Response.json(
      { code: "bad_name", message: translate(locale, "failure.noFile") }, { status: 400 }
    );
  try {
    return Response.json(await ingestUpload(getDb(), Buffer.from(await file.arrayBuffer()), file.name));
  } catch (e) {
    if (e instanceof Failure)
      return Response.json({ code: e.code, ...e.localized(locale) }, { status: 400 });
    // Never rethrow: Next would answer with an HTML 500 that the drop zone cannot parse.
    return Response.json({ code: "ingest_failed", message: (e as Error).message }, { status: 500 });
  }
}
