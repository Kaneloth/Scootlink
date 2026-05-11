import React from 'react';
import { Card } from '@/components/ui/card';

export default function WalletCard({ balance = 0 }) {
  return (
    <div className="bg-primary rounded-2xl p-5 text-center text-white">
      <p className="text-sm opacity-80">Available Balance</p>
      <p className="text-3xl font-extrabold mt-1">
        R {typeof balance === 'number' ? balance.toFixed(2) : '0.00'}
      </p>
    </div>
  );
}
