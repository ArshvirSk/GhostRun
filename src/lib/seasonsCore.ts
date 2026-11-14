/**
 * NF-31: Season Framework & Remote Announcement Banners Core Engine
 */

export interface Season {
  id: string;
  number: number;
  name: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

export interface AnnouncementBanner {
  id: string;
  title: string;
  subtitle?: string | null;
  link_url?: string | null;
  starts_at: string;
  ends_at: string;
  is_active?: boolean;
}

export interface SeasonCountdown {
  daysRemaining: number;
  hoursRemaining: number;
  label: string;
  isEnded: boolean;
}

/**
 * Calculates remaining days and hours until season conclusion
 */
export function calculateSeasonCountdown(
  endsAt: Date | string,
  now: Date = new Date()
): SeasonCountdown {
  const endDate = typeof endsAt === 'string' ? new Date(endsAt) : endsAt;
  const diffMs = endDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return {
      daysRemaining: 0,
      hoursRemaining: 0,
      label: 'Season Ended',
      isEnded: true,
    };
  }

  const hoursTotal = Math.floor(diffMs / (1000 * 60 * 60));
  const daysTotal = Math.floor(hoursTotal / 24);
  const remainingHours = hoursTotal % 24;

  let label = '';
  if (daysTotal > 1) {
    label = `Season ends in ${daysTotal} days`;
  } else if (daysTotal === 1) {
    label = `Season ends in 1 day`;
  } else if (hoursTotal > 1) {
    label = `Season ends in ${hoursTotal} hours`;
  } else {
    label = `Season ends in < 1 hour`;
  }

  return {
    daysRemaining: daysTotal,
    hoursRemaining: remainingHours,
    label,
    isEnded: false,
  };
}

/**
 * Filters banners valid at the given reference time
 */
export function filterActiveBanners(
  banners: AnnouncementBanner[],
  now: Date = new Date()
): AnnouncementBanner[] {
  const nowMs = now.getTime();
  return banners.filter((b) => {
    if (b.is_active === false) return false;
    const startMs = new Date(b.starts_at).getTime();
    const endMs = new Date(b.ends_at).getTime();
    return nowMs >= startMs && nowMs <= endMs;
  });
}
