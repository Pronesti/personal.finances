import { selectedBackend, withAccounting } from "@/lib/backend";
import { getT } from "@/lib/locale";

export async function GET(_request: Request, { params }: { params: Promise<{ hash: string }> }): Promise<Response> {
  if (selectedBackend() !== "postgres") return new Response(null, { status: 404 });
  const { hash } = await params;
  if (!/^[a-f0-9]{64}$/.test(hash)) return Response.json({ code: "invalid_document_reference" }, { status: 400 });
  try {
    const bytes = await withAccounting(async ({ ledger, documents }) => {
      const reference = await ledger.transaction(tx => tx.sourceObject(hash));
      if (!reference) return null;
      const data = await documents.read(reference);
      if (data.byteLength !== reference.byteLength) throw new Error("document_size_mismatch");
      return data;
    });
    if (bytes === null) return new Response(null, { status: 404 });
    const isPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": isPdf ? "application/pdf" : "application/octet-stream",
      "Content-Disposition": `${isPdf ? "inline" : "attachment"}; filename="source-${hash}${isPdf ? ".pdf" : ".bin"}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    const t = await getT();
    return Response.json({ code: "document_unavailable", message: t("accounting.error.setup") }, { status: 500 });
  }
}
