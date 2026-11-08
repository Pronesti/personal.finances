import https from 'node:https';
import {exportStreamLength} from './export-stream.mjs';
import http from 'node:http';
import {uploadEnvelope} from './upload-envelope.mjs';
import { randomUUID, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const monotonic = () => Number(process.hrtime.bigint()) / 1e6;
export const LIMITS = Object.freeze({ total: 720000, upload: 180000, nonOcr: 180000, ocr: 180000, body: 48 * 1024 * 1024 });

/** This function has no fault-injection/disable-budget parameter. */
export function phaseExpiry(start, now, uploaded, snapshot = null) {
  const elapsed = now - start;
  if (!uploaded && elapsed >= LIMITS.upload) return { status: 408, code: 'upload_timeout' };
  if (elapsed >= LIMITS.total) return { status: 504, code: 'processing_timeout' };
  if (snapshot === null) return elapsed >= LIMITS.nonOcr ? { status: 504, code: 'non_ocr_budget_exceeded' } : null;
  const lag = Math.max(0, now - snapshot.clockMs);
  if (snapshot.activeOcr === null) return snapshot.nonOcrMs + lag >= LIMITS.nonOcr ? { status: 504, code: 'non_ocr_budget_exceeded' } : null;
  if (snapshot.activeOcr < 1 || snapshot.activeOcr > 3 || snapshot.nonOcrMs >= LIMITS.nonOcr || !Number.isFinite(snapshot.ocrMs[snapshot.activeOcr])) return { status: 503, code: 'deadline_metadata_invalid' };
  return snapshot.ocrMs[snapshot.activeOcr] + lag >= LIMITS.ocr ? { status: 504, code: 'ocr_attempt_timeout' } : null;
}

export function createIngress(config) {
  const root = realpathSync(config.root);
  if (root !== config.root || lstatSync(root).isSymbolicLink() || (lstatSync(root).mode & 0o077) || typeof config.key !== 'string' || config.key.length < 64 || new URL(config.origin).protocol !== 'https:') throw new Error('Private ingress configuration invalid');
  const server = https.createServer({ key: readFileSync(config.tlsKey), cert: readFileSync(config.tlsCert), maxHeaderSize: 16384 }, (request, response) => {
    const state = request.socket.tarjetasStart;
    if (!state || request.headers.host !== new URL(config.origin).host) { response.writeHead(400).end(); return; }
    const id = randomUUID(), directory = `${root}/${id}`;
    mkdirSync(directory, { mode: 0o700 });
    const stamp = JSON.stringify({ id, start: state.wall, deadline: state.wall + LIMITS.total, clockDomain: 'same-host-monotonic-v1', monotonicStartMs: state.mono });
    writeFileSync(`${directory}/origin.json`, stamp, { mode: 0o600, flag: 'wx' });
    let uploaded = false, upstream = null, dispatched = false, complete = false, cancelled = false, cleanup = null, upstreamConnected = false;
    function releaseContext() { if (cleanup !== null) { clearInterval(cleanup); cleanup = null; } rmSync(directory, { recursive: true, force: true }); }
    const chunks = []; let length = 0;
    const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json', Connection: 'close' };
    if (request.headers.origin === config.frontend) Object.assign(headers, { 'Access-Control-Allow-Origin': config.frontend, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' });
    function cancel(status, code) {
      if (cancelled || complete) return;
      cancelled = true;
      writeFileSync(`${directory}/cancelled`, code, { mode: 0o600 });
      clearInterval(timer);
      if (!response.headersSent) response.writeHead(status, headers).end(JSON.stringify({ error: { code, message_key: `errors.${code}`, params: {} } }));
      else response.destroy();
      // Keep the upstream socket alive until PHP acknowledges cancellation/cleanup.
      chunks.length = 0;
      if (!dispatched) { request.resume(); releaseContext(); }
      else {
        cleanup = setInterval(() => {
          if (existsSync(`${directory}/backend.done`)) { upstream?.destroy(); releaseContext(); }
        }, 50);
        cleanup.unref();
      }
    }
    function poll() {
      let snapshot = null;
      try { if (existsSync(`${directory}/phase.json`)) snapshot = JSON.parse(readFileSync(`${directory}/phase.json`, 'utf8')); }
      catch { return cancel(503, 'deadline_metadata_invalid'); }
      const failure = phaseExpiry(state.mono, monotonic(), uploaded, snapshot);
      if (failure) cancel(failure.status, failure.code);
      return failure;
    }
    const timer = setInterval(poll, 10);
    request.on('data', chunk => {
      if (cancelled || poll()) return;
      length += chunk.length;
      if (length > LIMITS.body) return cancel(413, 'too_large');
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (cancelled || poll()) return;
      uploaded = true;
      const body = Buffer.concat(chunks);
      const envelope = uploadEnvelope(request.method, request.url, request.headers['content-type'], body);
      if (envelope) return cancel(envelope.status, envelope.code);
      const clean = Object.fromEntries(Object.entries(request.headers).filter(([name]) => {
        const normalized=name.replaceAll('_','-');
        return !normalized.startsWith('x-tarjetas-')&&!normalized.startsWith('tarjetas-ingress-')&&!normalized.startsWith('x-forwarded-')&&!['connection','transfer-encoding','host','forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto'].includes(normalized);
      }));
      Object.assign(clean, { host: new URL(config.origin).host, connection: 'close', 'content-length': length, 'x-forwarded-proto': 'https', 'x-tarjetas-deadline': stamp, 'x-tarjetas-signature': createHmac('sha256', config.key).update(`${request.method}\n${request.url}\n${stamp}`).digest('hex') });
      dispatched = true;
      upstream = http.request({ hostname: '127.0.0.1', port: config.upstreamPort, method: request.method, path: request.url, headers: clean }, result => {
        if (cancelled) { result.on('end', releaseContext); result.resume(); return; }
        // Financial command JSON remains buffered; authorized exports use bounded-memory backpressure.
        const output = []; let size = 0;
        const streamLength=exportStreamLength(request.method,request.url,result.statusCode,result.headers);
        const replyHeaders={...result.headers,connection:'close'};delete replyHeaders['transfer-encoding'];
        if(streamLength!==null){if(poll()){result.resume();return;}response.writeHead(result.statusCode,replyHeaders);}
        result.on('data',chunk=>{
          if(cancelled)return;size+=chunk.length;
          if(streamLength!==null){
            if(size>streamLength){cancel(502,'upstream_response_length');return;}
            if(!response.write(chunk)){result.pause();response.once('drain',()=>result.resume());}
          }else if(size>64*1024*1024){cancel(502,'upstream_response_limit');}else{output.push(chunk);}
        });
        result.on('error',()=>{cancel(502,'upstream_incomplete');releaseContext();});
        result.on('end',()=>{
          if(cancelled){releaseContext();return;}
          if(poll()){releaseContext();return;}
          if(streamLength!==null&&size!==streamLength){cancel(502,'upstream_response_length');releaseContext();return;}
          complete=true;clearInterval(timer);
          if(streamLength!==null){response.end();}else{response.writeHead(result.statusCode,replyHeaders).end(Buffer.concat(output));}
          releaseContext();
        });

      });
      upstream.on('socket', socket => { if (!socket.connecting) upstreamConnected = true; else socket.once('connect', () => { upstreamConnected = true; }); });
      upstream.on('error', () => { cancel(502, 'upstream_unavailable'); if (!upstreamConnected) releaseContext(); });
      upstream.end(body); chunks.length = 0;
    });
    request.on('aborted', () => cancel(499,'client_disconnected'));
    response.on('close', () => { if (!complete && !cancelled) cancel(499,'client_disconnected'); });
    request.on('error', () => cancel(400,'upload_failed'));
  });
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 0; server.headersTimeout = 0; server.timeout = 0;
  server.on('secureConnection', socket => {
    // Runs before any application request/body buffering, including slow headers.
    socket.prependOnceListener('data', () => {
      socket.tarjetasStart = { mono: monotonic(), wall: Date.now() };
      const headerDeadline = setTimeout(() => {
        if (!socket.tarjetasDispatched) socket.end('HTTP/1.1 408 Request Timeout\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      }, LIMITS.upload);
      headerDeadline.unref(); socket.once('close', () => clearTimeout(headerDeadline));
    });
  });
  server.prependListener('request', request => { request.socket.tarjetasDispatched = true; });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node ingress/server.mjs /absolute/private/config.json');
  const path = process.argv[2];
  if (!path.startsWith('/') || realpathSync(path) !== path || (lstatSync(path).mode & 0o077)) throw new Error('Config must be private');
  const config = JSON.parse(readFileSync(path,'utf8'));
  const server = createIngress(config);
  server.listen(config.port, '127.0.0.1', () => process.stdout.write(`Private local ingress listening on 127.0.0.1:${config.port}\n`));
}
