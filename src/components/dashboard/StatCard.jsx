import React from 'react';
import { Card } from '@/components/ui/card';

export default function StatCard({ icon: Icon, label, value, subtitle, variant = 'default' }) {
  const bgClasses = {
    default: 'bg-card',
    primary: 'bg-primary text-primary-foreground',
    gradient: 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground',
  };

  return (
    <Card className={`p-5 ${bgClasses[variant]} border-0 shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-wider ${variant !== 'default' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
            {label}
          </p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subtitle && (
            <p className={`text-xs mt-1 ${variant !== 'default' ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
              {subtitle}
            </p>
          )}
        </div>
        {Icon && (
          <div className={`p-2.5 rounded-xl ${variant !== 'default' ? 'bg-white/15' : 'bg-primary/10'}`}>
            <Icon className={`w-5 h-5 ${variant !== 'default' ? '' : 'text-primary'}`} />
          </div>
        )}
      </div>
    </Card>
  );
}