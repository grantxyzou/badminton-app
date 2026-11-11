/**
 * Page memory a real browser loses on every reload — or keeps on the phone and
 * a test must not inherit — reset before every test: the bag `useGear`
 * remembers across remounts, last time's week (`lib/homeSnapshot.ts`), the
 * quick-return note (`lib/quickReturn.ts`) and the remembered pictures.
 */
import { beforeEach } from 'vitest';
import { resetGearMemory } from '../../components/stats/gearMemory';
import { forgetHomeSnapshot } from '../../lib/homeSnapshot';
import { forgetActive } from '../../lib/quickReturn';
import { forgetPictures } from '../../lib/warmPictures';

beforeEach(() => {
  resetGearMemory();
  forgetHomeSnapshot();
  forgetActive();
  forgetPictures();
});
