// Vercel function entry: forwards every request to the compiled API (built by `pnpm --filter "@mafk/api..." run build`).
// The API is loaded lazily so that a start-up problem (missing/invalid environment variable, missing file, database
// URL) is answered with a readable JSON message instead of an opaque "500 FUNCTION_INVOCATION_FAILED".
let loading;

const describe = (e) => {
  const text = String((e && e.message) || e)
    .replace(/[a-z]+:\/\/[^\s"']+/gi, '<url hidden>')
    .slice(0, 800);
  return { status: 'startup_error', name: (e && e.name) || 'Error', code: (e && e.code) || null, message: text };
};

export default async function handler(req, res) {
  try {
    loading ??= import('../apps/api/dist/vercel.js').then((m) => m.default);
    const app = await loading;
    return app(req, res);
  } catch (e) {
    loading = undefined;
    console.error('API start-up failed:', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(describe(e)));
  }
}
