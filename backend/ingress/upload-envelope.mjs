const MAX_OVERHEAD = 1024 * 1024;
const MAX_PARTS = 32;
const MAX_HEADERS = 16384;

/** Check raw framing before PHP can truncate extra files or silently discard fields. */
export function uploadEnvelope(method, url, contentType, body) {
  let path;
  try { path = decodeURIComponent(url.startsWith('/') ? url.split(/[?#]/, 1)[0] : new URL(url).pathname).replace(/\/+/g, '/'); }
  catch { return {status: 400, code: 'invalid_upload_envelope'}; }
  if (method !== 'POST' || !/^\/api\/v1\/(statements|receipts)(\/import)?\/?$/.test(path) || !/^multipart\/form-data(?:;|$)/i.test(contentType ?? '')) return null;
  const boundary = /;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType);
  const value = boundary?.[1] ?? boundary?.[2];
  const invalid = {status: 400, code: 'invalid_upload_envelope'};
  if (!value || value.length > 70 || !/^[\w'()+,./:=? -]+$/.test(value) || value.endsWith(' ')) return invalid;
  const marker = Buffer.from('--' + value), delimiter = Buffer.from('\r\n--' + value);
  let at = 0, parts = 0, files = 0, fileBytes = 0;
  const fields = new Set();
  while (true) {
    if (!body.subarray(at, at + marker.length).equals(marker)) return invalid;
    at += marker.length;
    if (body.subarray(at, at + 2).toString() === '--') {
      at += 2;
      if (body.subarray(at, at + 2).toString() === '\r\n') at += 2;
      if (at !== body.length) return invalid;
      return body.length - fileBytes > MAX_OVERHEAD ? {status: 413, code: 'too_large'} : null;
    }
    if (body.subarray(at, at + 2).toString() !== '\r\n' || ++parts > MAX_PARTS) return invalid;
    at += 2;
    const endHeaders = body.indexOf('\r\n\r\n', at);
    if (endHeaders < 0 || endHeaders - at > MAX_HEADERS) return invalid;
    const headers = body.subarray(at, endHeaders).toString('latin1').split('\r\n');
    const dispositions = headers.filter(line => /^content-disposition:/i.test(line));
    if (dispositions.length !== 1 || !/^content-disposition:\s*form-data;/i.test(dispositions[0])) return invalid;
    const name = /;\s*name="([^"\r\n]+)"/i.exec(dispositions[0])?.[1];
    if (!name || name.length > 200 || /[\[\]]/.test(name) || fields.has(name)) return invalid;
    fields.add(name);
    const isFile = /;\s*filename(?:\*)?=/i.test(dispositions[0]);
    if (isFile && (name !== 'file' || ++files > 1)) return invalid;
    const start = endHeaders + 4;
    let end = body.indexOf(delimiter, start);
    while (end >= 0 && !['\r\n', '--'].includes(body.subarray(end + delimiter.length, end + delimiter.length + 2).toString())) end = body.indexOf(delimiter, end + 1);
    if (end < 0) return invalid;
    if (isFile) {
      fileBytes += end - start;
      const limit = path.includes('/statements') ? 10 * 1024 * 1024 : 40 * 1024 * 1024;
      if (fileBytes > limit) return {status: 400, code: 'too_large'};
    }
    at = end + 2;
  }
}
