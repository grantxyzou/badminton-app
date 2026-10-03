/**
 * Where a member sends their e-transfer — the one place a MEMBER is told the
 * club's payment address.
 *
 * Security rule 10 keeps `eTransferRecipient` off every general read (the
 * session GET strips it for non-admins). It is returned only alongside a
 * person's OWN balance (`GET /api/players/unpaid`, owner-or-admin): the one
 * reader who owes the money and needs to know where it goes.
 *
 * Resolution, first hit wins: the group doc's settings (where
 * `/api/admin/settings` writes once groups are on) → an active admin's Member
 * doc (where it wrote before) → `NEXT_PUBLIC_ETRANSFER_EMAIL`, the build-time
 * value the Home card read on its own until 2026-10, which named one club's
 * organiser for every club.
 */
import { getContainer } from './cosmos';
import { readGroup } from './groups';
import { BPM_GROUP_ID } from './groupScope';
import type { ETransferRecipient, Member } from './types';

export interface PayTo {
  name: string;
  email: string;
}

const usable = (r: ETransferRecipient | undefined | null): r is ETransferRecipient =>
  !!r && typeof r.email === 'string' && r.email.includes('@');

export async function clubPayTo(groupId: string): Promise<PayTo | null> {
  try {
    const group = await readGroup(groupId);
    const r = group?.settings?.eTransferRecipient;
    if (usable(r)) return { name: r.name ?? '', email: r.email };
  } catch (err) {
    console.error('payTo: group read failed', err);
  }
  // The Member fallback is BPM's history only — another club has a group doc.
  if (groupId === BPM_GROUP_ID) {
    try {
      const { resources } = await getContainer('members')
        .items.query<Member>({ query: "SELECT * FROM c WHERE c.role = 'admin' AND c.active = true" })
        .fetchAll();
      const admin = (resources ?? [])
        .filter((m) => m.role === 'admin' && m.active === true && usable(m.eTransferRecipient))
        .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))[0];
      if (admin?.eTransferRecipient) return { name: admin.eTransferRecipient.name ?? '', email: admin.eTransferRecipient.email };
    } catch (err) {
      console.error('payTo: admin read failed', err);
    }
    const env = process.env.NEXT_PUBLIC_ETRANSFER_EMAIL;
    if (env && env.includes('@')) return { name: '', email: env };
  }
  return null;
}
