import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PageHeader({ title, subtitle, backTo, action }) {
  const navigate = useNavigate();
  // backTo is normally a fixed path ("/home", "/settings", etc.) for pages
  // that always want to land somewhere specific regardless of how the user
  // got there. Passing backTo={-1} instead means "use real browser history"
  // — for pages reachable from more than one place, where a fixed
  // destination would create a back-button loop (e.g. Contact Support,
  // reachable from both the header shortcut and Settings).
  const handleBack = () => {
    if (backTo === -1) navigate(-1);
    else navigate(backTo);
  };

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        {backTo !== undefined && backTo !== null && (
          <Button variant="ghost" size="icon" onClick={handleBack} className="rounded-full -ml-2">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}