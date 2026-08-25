import { getDb } from "@/lib/db";
import { ingestUpload } from "@/lib/upload";
import { Failure } from "@/lib/failure";

export async function POST(request: Request): Promise<Response> {
  const file = (await request.formData()).get("file");
  if (!(file instanceof File))
    return Response.json({ code: "bad_name", message: "The request carried no file." }, { status: 400 });
  try {
    return Response.json(await ingestUpload(getDb(), Buffer.from(await file.arrayBuffer()), file.name));
  } catch (e) {
    if (e instanceof Failure)
      return Response.json({ code: e.code, message: e.message, hint: e.hint }, { status: 400 });
    // Never rethrow: Next would answer with an HTML 500 that the drop zone cannot parse.
    return Response.json({ code: "ingest_failed", message: (e as Error).message }, { status: 500 });
  }
}
