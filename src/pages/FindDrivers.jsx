import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, auth } from '@/api/supabaseData';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, MessageCircle, ShieldCheck, SlidersHorizontal, X, Lock, User as UserIcon, Star } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import StarRating from '@/components/reviews/StarRating';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';

export default function FindDrivers() {
  // … all the existing state and logic (unchanged) …
  // (I’m leaving those out for brevity – just keep the same code you already have 
  //  for navigate, driverReviews, filters, currentUser, selectedDriver, etc.)

  // … inside the return, the card rendering section becomes:
  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto overflow-x-hidden">
      {/* … PageHeader and filters unchanged … */}

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : drivers.length > 0 ? (
        <div className="space-y-3">
          {drivers.map(d => {
            const exp = d.license_year ? currentYear - d.license_year : 0;
            return (
              <Card
                key={d.id}
                className="p-4 border border-border/50 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => openDriverDetail(d)}
              >
                {/* Changed from "flex items-center justify-between" to allow wrapping */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0">
                      {d.full_name?.[0] || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-foreground text-sm truncate">{d.full_name || 'Driver'}</h4>
                        {d.verified && <ShieldCheck className="w-4 h-4 text-primary shrink-0" />}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                        {d.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{d.location}</span>}
                        {exp > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{exp}y exp</span>}
                        {d.rating > 0 && <StarRating value={Math.round(d.rating)} size="sm" showValue />}
                      </div>
                    </div>
                  </div>
                  {/* Slightly smaller button text/padding on mobile, still shrink-0 */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs px-2.5 py-1.5"
                    onClick={(e) => { e.stopPropagation(); openDriverDetail(d); }}
                  >
                    <UserIcon className="w-3 h-3 mr-1" /> Details
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon="👤" title="No drivers found" description="Try adjusting your search filters" />
      )}

      {/* … Driver Detail Modal unchanged … */}
    </div>
  );
}
