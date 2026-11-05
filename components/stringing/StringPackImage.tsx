import { stringPackSrc } from '@/lib/stringPackSrc';

/**
 * A catalog string's packet picture (`docs/plans/string-packets.md`): the
 * pre-rendered `public/strings/<id>.webp`, or nothing when the string has none
 * (the caller keeps whatever it showed before). Decorative — the row or page
 * beside it names the string.
 */
export default function StringPackImage({ catalogId, size }: { catalogId: string | null | undefined; size: 'row' | 'hero' }) {
  const src = stringPackSrc(catalogId);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a same-origin pre-rendered WebP; next/image adds nothing here.
    <img src={src} alt="" width={240} height={336} loading="lazy" decoding="async" className={`string-pack-img string-pack-${size}`} />
  );
}
