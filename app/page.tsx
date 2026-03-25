'use client';

import { useState } from 'react';
import BottomNav from '@/components/BottomNav';
import HomeTab from '@/components/HomeTab';
import PlayersTab from '@/components/PlayersTab';
import AdminTab from '@/components/AdminTab';
import GlassPhysics from '@/components/GlassPhysics';

export type Tab = 'home' | 'players' | 'admin';

export default function Page() {
  const [activeTab, setActiveTab] = useState<Tab>('home');

  return (
    <div className="min-h-screen pb-32">
      <GlassPhysics />
      <div className="max-w-lg mx-auto px-4 pt-6">
        {activeTab === 'home' && <HomeTab onTabChange={setActiveTab} />}
        {activeTab === 'players' && <PlayersTab />}
        {activeTab === 'admin' && <AdminTab />}
      </div>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
