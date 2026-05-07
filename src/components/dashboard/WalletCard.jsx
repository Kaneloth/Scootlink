import React from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ArrowRight } from 'lucide-react';

export default function WalletCard({ balance = 0 }) {
  return (
    <Link to="/wallet" className="block">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 p-6 text-primary-foreground shadow-lg hover:shadow-xl transition-shadow">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 text-primary-foreground/70 text-sm font-medium">
            <Wallet className="w-4 h-4" />
            Wallet Balance
          </div>
          <p className="text-3xl font-extrabold mt-2 tracking-tight">
            R {balance.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
          </p>
          <div className="flex items-center gap-1 mt-3 text-xs text-primary-foreground/60 font-medium">
            Tap to manage
            <ArrowRight className="w-3 h-3" />
          </div>
        </div>
      </div>
    </Link>
  );
}