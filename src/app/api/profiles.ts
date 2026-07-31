/**
 * Profiles API — the data-source seam (docs/API.md).
 * Pages/layouts/actions call this module and never a backend directly.
 * Swapping to the Drizzle/Supabase backend = changing this one re-export;
 * call sites don't change.
 */
export { profilesApi } from '@/app/data/json/profiles';
