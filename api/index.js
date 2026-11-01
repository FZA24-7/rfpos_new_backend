// Vercel function entry: forwards every request to the compiled API (built by `pnpm --filter "@mafk/api..." run build`).
export { default } from '../apps/api/dist/vercel.js';
