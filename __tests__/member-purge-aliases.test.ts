import { describe, it, expect, beforeEach } from 'vitest';
import { purgeMember } from '@/lib/memberPurge';
import { resetMockStore, getStore, seedDoc } from './helpers';

/**
 * A member's bank legal name must not outlive their deletion request — on an
 * alias written with their memberId (the payments queue, 2026-10-06) AND on the
 * older rows the admin alias screen wrote with none.
 */
describe('purgeMember — aliases', () => {
  beforeEach(() => resetMockStore());

  it('deletes their aliases with or without a memberId, and leaves everyone else\'s', async () => {
    seedDoc('aliases', { id: 'a1', groupId: 'bpm', appName: 'Lin', etransferName: 'MEI LING CHAN', memberId: 'm-lin' });
    seedDoc('aliases', { id: 'a2', groupId: 'bpm', appName: 'lin', etransferName: 'LIN DAN' });
    seedDoc('aliases', { id: 'a3', groupId: 'bpm', appName: 'Viktor', etransferName: 'V AXELSEN' });
    // Same app name, but it names ANOTHER member: not this person's to delete.
    seedDoc('aliases', { id: 'a4', groupId: 'other', appName: 'Lin', etransferName: 'LIN OTHER', memberId: 'm-other' });
    await purgeMember('m-lin', 'Lin');
    expect((getStore()['aliases'] as Array<{ id: string }>).map((a) => a.id).sort()).toEqual(['a3', 'a4']);
  });
});
