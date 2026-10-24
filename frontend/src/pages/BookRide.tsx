import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import API from '../api/axios';
import { loadGoogleMapsApi } from '../utils/googleMaps';
import { resolveAddressCoordinates } from '../utils/geocoding';
import { FareBreakdown, Location, PaymentMethod, RideType } from '../types';

const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

interface RideTypeOption {
  id: RideType;
  label: string;
  icon: string;
  desc: string;
}

const RIDE_TYPES: RideTypeOption[] = [
  { id: 'economy', label: 'Economy', icon: '🚗', desc: 'Affordable and practical' },
  { id: 'comfort', label: 'Comfort', icon: '🚙', desc: 'Extra space and comfort' },
  { id: 'premium', label: 'Premium', icon: '🏎️', desc: 'Luxury experience' },
];

const PAYMENT_METHODS: Array<{ id: PaymentMethod; label: string; icon: string }> = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'card', label: 'Card', icon: '💳' },
];

const toCoords = (point: { lat?: number; lng?: number }) => ({
  lat: Number(point.lat),
  lng: Number(point.lng),
});

const circleIcon = (maps: any, fillColor: string, scale = 8) => ({
  path: maps.SymbolPath.CIRCLE,
  fillColor,
  fillOpacity: 1,
  strokeColor: '#0b1220',
  strokeWeight: 2,
  scale,
});

export default function BookRide(): React.ReactElement {
  const navigate = useNavigate();

  const [form, setForm] = useState<{
    pickupAddress: string;
    dropoffAddress: string;
    rideType: RideType;
    paymentMethod: PaymentMethod;
  }>({
    pickupAddress: '',
    dropoffAddress: '',
    rideType: 'economy',
    paymentMethod: 'cash',
  });

  const [loading, setLoading] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [pickupPlace, setPickupPlace] = useState<Location | null>(null);
  const [dropoffPlace, setDropoffPlace] = useState<Location | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    distanceKm: number;
    durationMin: number;
    distanceText: string;
    durationText: string;
  } | null>(null);
  const [userPriceAddon, setUserPriceAddon] = useState<number>(0);
  const [quotes, setQuotes] = useState<FareBreakdown[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const pickupInputRef = useRef<HTMLInputElement | null>(null);
  const dropoffInputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const directionsServiceRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);
  const distanceMatrixServiceRef = useRef<any>(null);
  const markerRefs = useRef<Record<string, any>>({ pickup: null, dropoff: null, current: null });
  const googleMapsRef = useRef<any>(null);

  const selectedQuote = useMemo(
    () => quotes.find((quote) => quote.rideType === form.rideType) || null,
    [quotes, form.rideType]
  );

  const estimatedDistanceKm = routeInfo?.distanceKm || selectedQuote?.distanceKm || 0;
  const estimatedFare = selectedQuote?.total || 0;

  const setMarker = (key: string, options: any) => {
    const maps = googleMapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || !options?.position) return;

    let marker = markerRefs.current[key];
    if (!marker) {
      marker = new maps.Marker({ map });
      markerRefs.current[key] = marker;
    }

    marker.setMap(map);
    marker.setPosition(options.position);
    marker.setIcon(options.icon || null);
    marker.setLabel(options.label || null);
    marker.setTitle(options.title || '');
    marker.setVisible(true);
  };

  const hideMarker = (key: string) => {
    const marker = markerRefs.current[key];
    if (marker) marker.setVisible(false);
  };

  // Initialize Google Maps
  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const maps = await loadGoogleMapsApi({ requirePlaces: true });
        if (disposed) return;
        googleMapsRef.current = maps;

        if (mapContainerRef.current && !mapRef.current) {
          mapRef.current = new maps.Map(mapContainerRef.current, {
            center: INDIA_CENTER,
            zoom: 5,
            minZoom: 4,
            maxZoom: 19,
            mapTypeId: 'roadmap',
            streetViewControl: false,
            fullscreenControl: true,
            mapTypeControl: true,
          });

          geocoderRef.current = new maps.Geocoder();
          directionsServiceRef.current = new maps.DirectionsService();
          directionsRendererRef.current = new maps.DirectionsRenderer({
            map: mapRef.current,
            suppressMarkers: true,
            polylineOptions: {
              strokeColor: '#f59e0b',
              strokeOpacity: 0.9,
              strokeWeight: 6,
            },
          });
          distanceMatrixServiceRef.current = new maps.DistanceMatrixService();
        }

        // Setup Autocomplete
        if (pickupInputRef.current) {
          const pickupAuto = new maps.places.Autocomplete(pickupInputRef.current, {
            componentRestrictions: { country: 'in' },
            fields: ['formatted_address', 'geometry', 'name'],
          });
          pickupAuto.addListener('place_changed', () => {
            const place = pickupAuto.getPlace();
            if (place.geometry?.location) {
              const loc = {
                address: place.formatted_address || place.name || '',
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
              };
              setPickupPlace(loc);
              setForm((prev) => ({ ...prev, pickupAddress: loc.address }));
            }
          });
        }

        if (dropoffInputRef.current) {
          const dropoffAuto = new maps.places.Autocomplete(dropoffInputRef.current, {
            componentRestrictions: { country: 'in' },
            fields: ['formatted_address', 'geometry', 'name'],
          });
          dropoffAuto.addListener('place_changed', () => {
            const place = dropoffAuto.getPlace();
            if (place.geometry?.location) {
              const loc = {
                address: place.formatted_address || place.name || '',
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
              };
              setDropoffPlace(loc);
              setForm((prev) => ({ ...prev, dropoffAddress: loc.address }));
            }
          });
        }

        setMapsReady(true);
      } catch (err: any) {
        setMapsError(err?.message || 'Google Maps unavailable');
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  // Update Route and Distance when pickup/dropoff places change
  useEffect(() => {
    const maps = googleMapsRef.current;
    const map = mapRef.current;
    if (!maps || !map || !directionsServiceRef.current) return;

    if (pickupPlace?.lat && pickupPlace?.lng) {
      setMarker('pickup', {
        position: toCoords(pickupPlace),
        title: 'Pickup Location',
        icon: circleIcon(maps, '#f59e0b', 9),
        label: { text: 'P', color: '#080e1e', fontWeight: '800' },
      });
    } else {
      hideMarker('pickup');
    }

    if (dropoffPlace?.lat && dropoffPlace?.lng) {
      setMarker('dropoff', {
        position: toCoords(dropoffPlace),
        title: 'Drop-off Destination',
        icon: circleIcon(maps, '#38bdf8', 9),
        label: { text: 'D', color: '#080e1e', fontWeight: '800' },
      });
    } else {
      hideMarker('dropoff');
    }

    if (
      pickupPlace?.lat &&
      pickupPlace?.lng &&
      dropoffPlace?.lat &&
      dropoffPlace?.lng
    ) {
      directionsServiceRef.current.route(
        {
          origin: toCoords(pickupPlace),
          destination: toCoords(dropoffPlace),
          travelMode: maps.TravelMode.DRIVING,
        },
        (result: any, status: string) => {
          if (status === 'OK' && result?.routes?.[0]?.legs?.[0]) {
            directionsRendererRef.current?.setDirections(result);
            map.fitBounds(result.routes[0].bounds, 70);
            const leg = result.routes[0].legs[0];
            const distKm = Number((leg.distance.value / 1000).toFixed(2));
            const durMin = Math.max(1, Math.round(leg.duration.value / 60));
            setRouteInfo({
              distanceKm: distKm,
              durationMin: durMin,
              distanceText: leg.distance.text,
              durationText: leg.duration.text,
            });
          }
        }
      );
    } else {
      directionsRendererRef.current?.set('directions', null);
      setRouteInfo(null);
    }
  }, [pickupPlace, dropoffPlace]);

  // Fetch Fare Quotes whenever route or addon changes
  useEffect(() => {
    const dist = routeInfo?.distanceKm || 8;
    const dur = routeInfo?.durationMin || 20;

    setQuoteLoading(true);
    API.post('/rides/quote', {
      distance: dist,
      estimatedDuration: dur,
      userPriceAddon,
    })
      .then((res) => {
        setQuotes(res.data.quotes || []);
      })
      .catch(() => {
        // Fallback local quotes
        const fallbackRates: Record<RideType, { base: number; perKm: number }> = {
          economy: { base: 35, perKm: 11 },
          comfort: { base: 55, perKm: 16 },
          premium: { base: 90, perKm: 24 },
        };
        const generated: FareBreakdown[] = (['economy', 'comfort', 'premium'] as RideType[]).map(
          (t) => {
            const rule = fallbackRates[t];
            const baseFare = rule.base;
            const distanceFare = dist * rule.perKm;
            const total = Math.round(baseFare + distanceFare + userPriceAddon);
            return {
              rideType: t,
              baseFare,
              distanceFare,
              timeFare: 0,
              trafficMultiplier: 1,
              trafficCharge: 0,
              userPriceAddon,
              subtotal: baseFare + distanceFare,
              total,
              distanceKm: dist,
              durationMin: dur,
            };
          }
        );
        setQuotes(generated);
      })
      .finally(() => setQuoteLoading(false));
  }, [routeInfo?.distanceKm, routeInfo?.durationMin, userPriceAddon]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };

        const maps = googleMapsRef.current;
        if (geocoderRef.current && maps) {
          geocoderRef.current.geocode({ location: coords }, (results: any, status: string) => {
            setLocationLoading(false);
            if (status === 'OK' && results?.[0]) {
              const address = results[0].formatted_address;
              const place: Location = { address, ...coords };
              setPickupPlace(place);
              setForm((prev) => ({ ...prev, pickupAddress: address }));
              mapRef.current?.panTo(coords);
              mapRef.current?.setZoom(15);
            }
          });
        } else {
          setLocationLoading(false);
          const fallbackLoc: Location = { address: `Current Location (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`, ...coords };
          setPickupPlace(fallbackLoc);
          setForm((prev) => ({ ...prev, pickupAddress: fallbackLoc.address }));
        }
      },
      () => {
        setLocationLoading(false);
        toast.error('Unable to retrieve your current location');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handlePickupBlur = async (): Promise<void> => {
    const text = form.pickupAddress.trim();
    if (text && (!pickupPlace || pickupPlace.address !== text)) {
      const resolved = await resolveAddressCoordinates(text, geocoderRef.current);
      setPickupPlace(resolved);
    }
  };

  const handleDropoffBlur = async (): Promise<void> => {
    const text = form.dropoffAddress.trim();
    if (text && (!dropoffPlace || dropoffPlace.address !== text)) {
      const resolved = await resolveAddressCoordinates(text, geocoderRef.current);
      setDropoffPlace(resolved);
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    const cleanPickup = form.pickupAddress.trim();
    const cleanDropoff = form.dropoffAddress.trim();

    if (!cleanPickup || !cleanDropoff) {
      toast.error('Please enter both pickup and drop-off locations');
      return;
    }

    if (cleanPickup.toLowerCase() === cleanDropoff.toLowerCase()) {
      toast.error('Pickup and drop-off cannot be the same address');
      return;
    }

    setLoading(true);
    try {
      // Ensure pickup and dropoff ALWAYS have valid, non-zero coordinates
      let finalPickup = pickupPlace;
      if (!finalPickup || !finalPickup.lat || !finalPickup.lng || finalPickup.address !== cleanPickup) {
        finalPickup = await resolveAddressCoordinates(cleanPickup, geocoderRef.current);
        setPickupPlace(finalPickup);
      }

      let finalDropoff = dropoffPlace;
      if (!finalDropoff || !finalDropoff.lat || !finalDropoff.lng || finalDropoff.address !== cleanDropoff) {
        finalDropoff = await resolveAddressCoordinates(cleanDropoff, geocoderRef.current);
        setDropoffPlace(finalDropoff);
      }

      const payload = {
        pickup: finalPickup,
        dropoff: finalDropoff,
        rideType: form.rideType,
        paymentMethod: form.paymentMethod,
        distance: routeInfo?.distanceKm || estimatedDistanceKm || 8,
        estimatedDuration: routeInfo?.durationMin || 20,
        userPriceAddon,
      };

      const res = await API.post('/rides/book', payload);
      const bookedRide = res.data.ride;

      toast.success('🚕 Ride booked! Connecting to drivers…');
      navigate(`/current-ride?rideId=${bookedRide._id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Booking failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 1100 }}>
        <div className="page-header" style={{ marginBottom: 24 }}>
          <h1>
            Book a <span>Ride</span>
          </h1>
          <p>Real-time routing, upfront fare breakdown, and instant driver matching</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
          {/* Booking Form Column */}
          <div>
            <form onSubmit={handleSubmit}>
              {/* Route Form */}
              <div className="card" style={{ marginBottom: 18 }}>
                <div className="flex-between" style={{ marginBottom: 16 }}>
                  <div className="section-title" style={{ fontSize: 15, margin: 0 }}>
                    📍 Route Details
                  </div>
                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    className="btn btn-ghost btn-sm"
                    disabled={locationLoading}
                  >
                    {locationLoading ? 'Locating…' : '🎯 Use Current Location'}
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label">Pickup Location</label>
                  <input
                    ref={pickupInputRef}
                    className="form-input"
                    type="text"
                    name="pickupAddress"
                    placeholder="Enter pickup address or landmark…"
                    value={form.pickupAddress}
                    onBlur={handlePickupBlur}
                    onChange={(e) => {
                      setForm({ ...form, pickupAddress: e.target.value });
                      if (!e.target.value) setPickupPlace(null);
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '2px 0 2px 10px' }}>
                  <div style={{ width: 2, height: 24, background: 'var(--border)', borderRadius: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Drop-off Destination</label>
                  <input
                    ref={dropoffInputRef}
                    className="form-input"
                    type="text"
                    name="dropoffAddress"
                    placeholder="Enter destination address…"
                    value={form.dropoffAddress}
                    onBlur={handleDropoffBlur}
                    onChange={(e) => {
                      setForm({ ...form, dropoffAddress: e.target.value });
                      if (!e.target.value) setDropoffPlace(null);
                    }}
                  />
                </div>
              </div>

              {/* Ride Type Selector */}
              <div className="card" style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ fontSize: 15, marginBottom: 14 }}>
                  🚗 Choose Vehicle Category
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {RIDE_TYPES.map((rt) => {
                    const quote = quotes.find((q) => q.rideType === rt.id);
                    const isSelected = form.rideType === rt.id;
                    return (
                      <button
                        key={rt.id}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, rideType: rt.id }))}
                        style={{
                          background: isSelected ? 'var(--amber-glow)' : 'var(--bg-elevated)',
                          border: `1.5px solid ${isSelected ? 'var(--amber)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius)',
                          padding: '14px 10px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{ fontSize: 26, marginBottom: 4 }}>{rt.icon}</div>
                        <div
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 14,
                            color: isSelected ? 'var(--amber)' : 'var(--text-primary)',
                            marginBottom: 2,
                          }}
                        >
                          {rt.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                          {rt.desc}
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: isSelected ? 'var(--amber)' : 'var(--text-primary)',
                          }}
                        >
                          {quoteLoading ? '…' : `₹${quote?.total || (rt.id === 'economy' ? 120 : rt.id === 'comfort' ? 190 : 280)}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Method */}
              <div className="card" style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ fontSize: 15, marginBottom: 12 }}>
                  💳 Payment Method
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {PAYMENT_METHODS.map((pm) => {
                    const isSelected = form.paymentMethod === pm.id;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, paymentMethod: pm.id }))}
                        style={{
                          background: isSelected ? 'var(--amber-glow)' : 'var(--bg-elevated)',
                          border: `1.5px solid ${isSelected ? 'var(--amber)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius)',
                          padding: '12px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          transition: 'all 0.2s',
                        }}
                      >
                        <span style={{ fontSize: 20 }}>{pm.icon}</span>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            color: isSelected ? 'var(--amber)' : 'var(--text-primary)',
                          }}
                        >
                          {pm.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Driver Priority Fare Boost */}
              <div className="card" style={{ marginBottom: 18 }}>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <div className="section-title" style={{ fontSize: 14, margin: 0 }}>
                    ⚡ Driver Priority Boost (Optional)
                  </div>
                  <strong style={{ color: 'var(--amber)' }}>+₹{userPriceAddon}</strong>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Add a tip to incentivize nearby drivers to accept your ride faster during peak hours.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[0, 20, 50, 100].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setUserPriceAddon(amt)}
                      className={`btn btn-sm ${userPriceAddon === amt ? 'btn-primary' : 'btn-ghost'}`}
                    >
                      {amt === 0 ? 'None' : `+₹${amt}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Total & Submit */}
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '16px 20px',
                  marginBottom: 18,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Estimated Total</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {routeInfo ? `${routeInfo.distanceText} · ${routeInfo.durationText}` : '~8 km estimated'}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: 26,
                    color: 'var(--amber)',
                  }}
                >
                  ₹{estimatedFare || (form.rideType === 'economy' ? 120 : form.rideType === 'comfort' ? 190 : 280)}
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>
                {loading ? (
                  <>
                    <div className="spinner" style={{ width: 18, height: 18 }} /> Booking ride…
                  </>
                ) : (
                  '🚕 Request Cab Now'
                )}
              </button>
            </form>
          </div>

          {/* Interactive Map Column */}
          <div>
            <div className="card" style={{ padding: 12, height: '100%', minHeight: 460 }}>
              <div className="flex-between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  🗺️ Route Preview
                </span>
                {routeInfo && (
                  <span style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 600 }}>
                    {routeInfo.distanceText} ({routeInfo.durationText})
                  </span>
                )}
              </div>

              <div className="map-shell" style={{ position: 'relative', height: 'calc(100% - 36px)', minHeight: 420 }}>
                <div ref={mapContainerRef} className="map-canvas" style={{ width: '100%', height: '100%', borderRadius: 8 }} />
                {!mapsReady && !mapsError && <div className="map-overlay">Loading Google Map…</div>}
                {mapsError && (
                  <div className="map-overlay map-overlay-error" style={{ padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📍</div>
                    <strong>Map Preview Unavailable</strong>
                    <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-secondary)' }}>
                      Set GOOGLE_MAPS_API_KEY in backend/.env for live Google Maps. Standard booking works directly!
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
