import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@/components/ui/card';
import { MapPin, Star, Calendar, X } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

const typeIcons = {
  scooter: '🛵', motorcycle: '🏍️', bicycle: '🚲', car: '🚗',
  suv: '🚙', bakkie: '🛻', van: '🚐', minibus_taxi: '🚌', truck: '🚚',
};

const statusStyles = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rented: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-blue-50 text-blue-700 border-blue-200',
  maintenance: 'bg-red-50 text-red-700 border-red-200',
};

export default function VehicleCard({ vehicle, onClick, showPrice = true }) {
  const [ownerRating, setOwnerRating] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  useEffect(() => {
    if (!vehicle?.owner_id) return;
    supabase
      .from('profiles')
      .select('rating')
      .eq('id', vehicle.owner_id)
      .single()
      .then(({ data }) => {
        if (data) setOwnerRating(data.rating);
      })
      .catch(() => {});
  }, [vehicle?.owner_id]);

  return (
    <>
      <Card
        className="p-4 hover:shadow-lg transition-all duration-200 cursor-pointer border border-border/50 group"
        onClick={onClick}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex gap-4 flex-1 min-w-0">
            <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center text-3xl shrink-0 group-hover:scale-105 transition-transform">
              {typeIcons[vehicle.vehicle_type] || '🛵'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground truncate">
                {vehicle.make} {vehicle.model}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {vehicle.year}
                </span>
                {vehicle.color && <span>{vehicle.color}</span>}
                {vehicle.transmission && (
                  <span className="capitalize">{vehicle.transmission}</span>
                )}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {vehicle.location}
                </span>
                {vehicle.rating > 0 && (
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    {vehicle.rating.toFixed(1)}
                  </span>
                )}
                {ownerRating !== null && ownerRating > 0 && (
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                    Owner {ownerRating.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {showPrice && (
            <div className="text-sm shrink-0">
              <span className="font-bold text-foreground">R {vehicle.price_per_week}</span>
              <span className="text-muted-foreground">/week</span>
              {vehicle.deposit > 0 && (
                <span className="text-muted-foreground text-xs ml-2">· R {vehicle.deposit} deposit</span>
              )}
            </div>
          )}
        </div>
        {vehicle.images?.length > 0 && (
          <div className="flex gap-2 mt-3 overflow-x-auto">
            {vehicle.images.slice(0, 3).map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightboxSrc(img); }}
                className="shrink-0 rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label="View full image"
              >
                <img src={img} alt="" className="w-16 h-12 rounded-lg object-cover" />
              </button>
            ))}
          </div>
        )}
      </Card>

      {lightboxSrc && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  );
}
