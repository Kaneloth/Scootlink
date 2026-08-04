import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@/components/ui/card';
import { MapPin, Star, X, ChevronLeft, ChevronRight } from 'lucide-react';
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

// Horizontal, swipeable photo carousel for the card's image area.
// Uses native CSS scroll-snap so touch swipe, trackpad, and the arrow
// buttons all stay in sync through the same scroll position — no manual
// drag-distance math needed, and browsers already suppress the click on
// a genuine swipe, so tap-to-zoom and swipe never fight each other.
function PhotoCarousel({ images, vehicleType, onImageTap }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rafRef = useRef(null);

  const hasImages = images.length > 0;

  const scrollToIndex = (i) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = ((i % images.length) + images.length) % images.length;
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
  };

  const handleScroll = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el || !el.clientWidth) return;
      setActiveIndex(Math.round(el.scrollLeft / el.clientWidth));
    });
  };

  if (!hasImages) {
    return (
      <div className="w-full h-full flex items-center justify-center text-5xl bg-muted">
        {typeIcons[vehicleType] || '🛵'}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full group/carousel">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((img, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onImageTap(i)}
            className="shrink-0 w-full h-full snap-center focus:outline-none"
            aria-label={`View photo ${i + 1} of ${images.length}`}
          >
            <img
              src={img}
              alt=""
              draggable={false}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); scrollToIndex(activeIndex - 1); }}
            className="hidden sm:flex items-center justify-center absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); scrollToIndex(activeIndex + 1); }}
            className="hidden sm:flex items-center justify-center absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity"
            aria-label="Next photo"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => { e.stopPropagation(); scrollToIndex(i); }}
                className={`h-1.5 rounded-full transition-all ${i === activeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`}
                aria-label={`Go to photo ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function VehicleCard({ vehicle, onClick, showPrice = true }) {
  const [ownerRating, setOwnerRating] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null); // null = closed

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

  const images = Array.isArray(vehicle.images) ? vehicle.images : [];
  const statusKey = (vehicle.status || 'available').toLowerCase();
  const statusLabel = vehicle.status
    ? vehicle.status.charAt(0).toUpperCase() + vehicle.status.slice(1)
    : 'Available';

  return (
    <>
      <Card
        className="overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer border border-border/50 group p-0"
        onClick={onClick}
      >
        <div className="relative w-full h-48">
          <PhotoCarousel
            images={images}
            vehicleType={vehicle.vehicle_type}
            onImageTap={(i) => setLightboxIndex(i)}
          />
        </div>

        <div className="px-4 pt-3 pb-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground truncate">
                <span className="mr-1">{typeIcons[vehicle.vehicle_type] || '🛵'}</span>
                {vehicle.make} {vehicle.model}
                {vehicle.year ? ` (${vehicle.year})` : ''}
              </h3>
              {(vehicle.color || vehicle.transmission) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                  {vehicle.color && <span>{vehicle.color}</span>}
                  {vehicle.transmission && <span className="capitalize">{vehicle.transmission}</span>}
                </div>
              )}
            </div>
            <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${statusStyles[statusKey] || statusStyles.available}`}>
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
            {vehicle.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {vehicle.location}
              </span>
            )}
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

          {showPrice && (
            <div className="mt-2 text-sm">
              <span className="font-bold text-foreground">R {vehicle.price_per_week}</span>
              <span className="text-muted-foreground">/week</span>
              {vehicle.deposit > 0 && (
                <span className="text-muted-foreground text-xs ml-2">· R {vehicle.deposit} deposit</span>
              )}
            </div>
          )}
        </div>
      </Card>

      {lightboxIndex !== null && images.length > 0 && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {images.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + images.length) % images.length); }}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-6 h-6 text-white" />
            </button>
          )}

          <img
            src={images[lightboxIndex]}
            alt=""
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />

          {images.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % images.length); }}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Next photo"
            >
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
