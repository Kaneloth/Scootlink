// src/pages/RequestGig.jsx
//
// destination: src/pages/RequestGig.jsx
//
// Customer-facing gig request form. Follows RentalRequest.jsx conventions
// (PageHeader, Card/Input/Label/Button, sonner toast, auth.me()).
//
// Geocoding: reuses the real geocodeLocation() from @/lib/geocode, same as
// AddVehicle.jsx — but UNLIKE AddVehicle.jsx's non-fatal "list without
// coordinates" fallback, a gig with unresolved coordinates can't be matched
// to any driver at all, so a failed geocode here blocks submission with a
// clear error instead of silently proceeding. Deliberate deviation, not an
// oversight.
//
// No live fare preview — fare is computed server-side in
// create-gig-request.js and shown on the waiting screen after creation,
// rather than duplicating the fare-calc + app_settings fetch logic here.
//
// "Use current location" for pickup is a best-effort enhancement via the
// standard browser Geolocation API (navigator.geolocation) — NOT
// @capacitor/geolocation (that's for the driver's continuous live-tracking
// broadcast, a different concern). Untested whether plain browser
// geolocation works inside your native WebView without additional native
// permission setup — falls back gracefully to manual typing if it fails or
// is denied.

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, supabase } from '@/api/supabaseData';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Car, Package, AlertTriangle, MapPin, Loader2, LocateFixed } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import AddressAutocompleteInput from '@/components/gigs/AddressAutocompleteInput';
import { toast } from 'sonner';

export default function RequestGig() {
  const navigate = useNavigate();

  const [gigType, setGigType] = useState(null); // 'ride' | 'delivery'
  const [pickupText, setPickupText] = useState('');
  const [dropoffText, setDropoffText] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);   // { latitude, longitude, displayName }
  const [dropoffCoords, setDropoffCoords] = useState(null);
  const [locatingDevice, setLocatingDevice] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Location access not available on this device');
      return;
    }
    setLocatingDevice(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        // Reverse-geocode not wired up here (geocodeLocation only does
        // forward geocoding) — show raw coordinates as the display text
        // rather than guessing at a reverse-geocode integration that
        // doesn't exist yet.
        setPickupCoords({ latitude, longitude, displayName: 'Current location' });
        setPickupText('Current location');
        setLocatingDevice(false);
      },
      (err) => {
        console.warn('[RequestGig] Geolocation failed:', err.message);
        toast.error('Could not get your location — please type your pickup address');
        setLocatingDevice(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const canSubmit =
    gigType &&
    pickupCoords &&
    dropoffCoords &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const user = await auth.me();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not signed in');

      const res = await fetch('/.netlify/functions/create-gig-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          gig_type: gigType,
          pickup_address: pickupText,
          pickup_lat: pickupCoords.latitude,
          pickup_lng: pickupCoords.longitude,
          dropoff_address: dropoffText,
          dropoff_lat: dropoffCoords.latitude,
          dropoff_lng: dropoffCoords.longitude,
          ...(gigType === 'delivery' ? {
            delivery_notes: deliveryNotes || undefined,
            recipient_name: recipientName || undefined,
            recipient_phone: recipientPhone || undefined,
          } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to request gig');

      toast.success(
        data.driversNotified > 0
          ? `Looking for a driver — ${data.driversNotified} nearby`
          : 'Request sent — searching for a driver'
      );
      navigate(`/gig-status/${data.gig.id}`);
    } catch (err) {
      console.error('[RequestGig] submit error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <PageHeader title="Request a Gig" subtitle="Get a ride or send a delivery" backTo="/home" />

      {/* Ride / Delivery selector — single tap, per planning notes §5.3 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => setGigType('ride')}
          className={`p-4 rounded-xl border-2 text-left transition-colors ${gigType === 'ride' ? 'border-primary bg-primary/5' : 'border-border/50'}`}
        >
          <Car className="w-6 h-6 mb-2 text-primary" />
          <p className="font-semibold text-sm">Ride</p>
        </button>
        <button
          onClick={() => setGigType('delivery')}
          className={`p-4 rounded-xl border-2 text-left transition-colors ${gigType === 'delivery' ? 'border-primary bg-primary/5' : 'border-border/50'}`}
        >
          <Package className="w-6 h-6 mb-2 text-primary" />
          <p className="font-semibold text-sm">Delivery</p>
        </button>
      </div>

      {gigType && (
        <Card className="p-6 border border-border/50">
          <div className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <Label>Pickup</Label>
              <div className="flex gap-2 mt-1">
                <div className="flex-1">
                  <AddressAutocompleteInput
                    value={pickupText}
                    onChange={setPickupText}
                    onResolved={setPickupCoords}
                    placeholder="Pickup address"
                  />
                </div>
                <Button type="button" variant="outline" size="icon" onClick={useCurrentLocation} disabled={locatingDevice}>
                  {locatingDevice ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
                </Button>
              </div>
              {pickupCoords && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {pickupCoords.displayName}
                </p>
              )}
            </div>

            <div>
              <Label>{gigType === 'ride' ? 'Drop-off' : 'Delivery address'}</Label>
              <div className="mt-1">
                <AddressAutocompleteInput
                  value={dropoffText}
                  onChange={setDropoffText}
                  onResolved={setDropoffCoords}
                  placeholder={gigType === 'ride' ? 'Where to?' : 'Delivery address'}
                />
              </div>
              {dropoffCoords && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {dropoffCoords.displayName}
                </p>
              )}
            </div>

            {gigType === 'delivery' && (
              <>
                <div>
                  <Label>Recipient name (optional)</Label>
                  <Input className="mt-1" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
                </div>
                <div>
                  <Label>Recipient phone (optional)</Label>
                  <Input className="mt-1" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />
                </div>
                <div>
                  <Label>Notes for the driver (optional)</Label>
                  <Textarea
                    className="mt-1"
                    placeholder="Package size, fragile items, gate code..."
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              </>
            )}

            <Button onClick={handleSubmit} className="w-full gap-2" disabled={!canSubmit}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {submitting ? 'Requesting...' : `Request ${gigType === 'ride' ? 'Ride' : 'Delivery'}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
