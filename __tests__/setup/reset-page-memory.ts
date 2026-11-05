/**
 * Page memory a real browser loses on every reload, reset before every test so
 * no test inherits another's: the bag `useGear` remembers across remounts.
 */
import { beforeEach } from 'vitest';
import { resetGearMemory } from '../../components/stats/gearMemory';

beforeEach(() => {
  resetGearMemory();
});
