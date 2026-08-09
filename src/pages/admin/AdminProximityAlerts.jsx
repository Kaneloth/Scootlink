import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Radar, CheckCircle2, XCircle, Play } from 'lucide-react';
import { toast } from 'sonner';

async function callProximityFunction(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch('/.netlify/functions/admin-run-proximity-scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export default function AdminProximityAlerts() {
  const [loading, setLoading] = useState(true);
  const [isActive, setIsActive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const data = await callProximityFunction('get_status');
      setIsActive(!!data.is_active);
      setUpdatedAt(data.updated_at);
    } catch (err) {
      toast.error('Could not load status: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const toggleActive = async () => {
    setToggling(true);
    try {
      const data = await callProximityFunction('toggle', { is_active: !isActive });
      setIsActive(data.is_active);
      toast.success(data.is_active ? 'Automatic daily alerts activated.' : 'Automatic daily alerts deactivated.');
    } catch (err) {
      toast.error('Failed: ' + err.message);
    } finally {
      setToggling(false);
    }
  };

  const runScanNow = async () => {
    setScanning(true);
    try {
      const result = await callProximityFunction('run_scan');
      setLastResult(result);
      toast.success(`Scan complete — ${result.drivers_alerted} driver(s) and ${result.owners_alerted} owner(s) alerted.`);
    } catch (err) {
      toast.error('Scan failed: ' + err.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2"><Radar className="w-5 h-5" /> Proximity Alerts</h2>
        <p className="text-sm text-muted-foreground">
          Notifies drivers about available vehicles, and owners about available drivers, within 20 km — only when there's something genuinely new since their last alert.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* Automatic schedule toggle */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Automatic Daily Scan</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Runs once a day while active. Manual scans below always work regardless of this setting, for testing.
                </p>
                {updatedAt && (
                  <p className="text-[10px] text-muted-foreground mt-1">Last changed: {new Date(updatedAt).toLocaleString('en-ZA')}</p>
                )}
              </div>
              <button
                disabled={toggling}
                onClick={toggleActive}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium shrink-0 disabled:opacity-60 ${
                  isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {isActive ? 'Active' : 'Inactive'}
              </button>
            </div>
          </div>

          {/* Manual scan */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold">Run Scan Now</p>
            <p className="text-xs text-muted-foreground">
              Immediately scans all users and sends alerts for genuinely new nearby matches. Useful for testing, or to run an extra scan outside the daily schedule.
            </p>
            <button
              onClick={runScanNow}
              disabled={scanning}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {scanning ? 'Scanning…' : 'Run Scan Now'}
            </button>

            {lastResult && (
              <div className="bg-muted rounded-lg p-3 text-xs flex gap-4">
                <span><span className="font-semibold text-foreground">{lastResult.drivers_alerted}</span> driver(s) alerted</span>
                <span><span className="font-semibold text-foreground">{lastResult.owners_alerted}</span> owner(s) alerted</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
