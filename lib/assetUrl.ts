/**
 * Where the generated pictures live (`docs/plans/asset-storage.md`): the
 * racket renders under `rackets/` and the string packets under `strings/`.
 *
 * `NEXT_PUBLIC_ASSET_BASE` names a storage container (Azure Blob Storage) that
 * holds them; unset, the app serves them from its own `public/` folder, as it
 * always has. Read at BUILD time, like every `NEXT_PUBLIC_*` value, so it is
 * set in `deploy-next.yml`'s build env, never only in App Settings.
 *
 * The one reader of that variable: `racketSrc`, `racketHeadSrc` and
 * `stringPackSrc` build their URLs here.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function remoteBase(): string {
  return (process.env.NEXT_PUBLIC_ASSET_BASE ?? '').trim().replace(/\/+$/, '');
}

/** The URL of a generated picture, `path` relative to the asset root (`rackets/x.webp`). */
export function assetUrl(path: string): string {
  const remote = remoteBase();
  const clean = path.replace(/^\/+/, '');
  return remote ? `${remote}/${clean}` : `${BASE_PATH}/${clean}`;
}

/** Whether pictures come from another origin, so a canvas drawing one must ask with CORS. */
export function assetsCrossOrigin(): boolean {
  return remoteBase() !== '';
}
