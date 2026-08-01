// Serve foto dari R2 lewat domain app: /photos/<key>
// Alasan: domain publik r2.dev diblokir banyak ISP Indonesia (internet positif),
// sedangkan pages.dev aman. Foto di-cache setahun (immutable, nama file unik).
export async function onRequestGet({ params, env }) {
  const key = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!key) return new Response('Bad request', { status: 400 });

  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('access-control-allow-origin', '*');
  return new Response(obj.body, { headers });
}
