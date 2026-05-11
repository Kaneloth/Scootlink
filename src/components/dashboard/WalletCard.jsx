import React from 'react';

export default function WalletCard({ balance = 0, showTapHint = true }) {
  return (
    <div className="bg-primary rounded-2xl p-5 text-center text-white">
      <p className="text-sm opacity-80">Available Balance</p>
      <p className="text-3xl font-extrabold mt-1">
        R {typeof balance === 'number' ? balance.toFixed(2) : '0.00'}
      </p>
      {showTapHint && (
        <p className="text-xs opacity-70 mt-1">Tap to manage</p>
      )}
    </div>
  );
}
