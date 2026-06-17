import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { publicApi } from '../../api/endpoints/public';
import { safeStorage } from '../lib/storage';

const SEEN_KEY = 'black_chart_events_seen';

// Header quick-access to the events feed, with a dot when there's a newer
// announcement than the user last viewed. Announcements are public, so this
// works in every mode (viewer / paper / live).
export function EventsBell() {
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicApi.getAnnouncements({ limit: 5 })
      .then((r) => {
        if (cancelled) return;
        const newest = (r.data || []).reduce((m, a) => Math.max(m, new Date(a.created_at).getTime() || 0), 0);
        const seen = Number(safeStorage.get(SEEN_KEY) || 0);
        setUnseen(newest > seen);
      })
      .catch(() => { /* announcements unavailable — leave the bell quiet */ });
    return () => { cancelled = true; };
  }, []);

  const markSeen = () => { safeStorage.set(SEEN_KEY, String(Date.now())); setUnseen(false); };

  return (
    <Link
      to="/events"
      onClick={markSeen}
      title="events"
      aria-label={unseen ? 'events (new)' : 'events'}
      className="text-sec"
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', alignSelf: 'center' }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unseen && (
        <span style={{ position: 'absolute', top: '-2px', right: '-3px', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--brand-up)' }} />
      )}
    </Link>
  );
}
