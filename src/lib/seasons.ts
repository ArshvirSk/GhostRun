/**
 * NF-31: Season Framework & Remote Announcement Banners Client Module
 */

import { supabase } from './supabase';
import {
  Season,
  AnnouncementBanner,
  SeasonCountdown,
  calculateSeasonCountdown,
  filterActiveBanners,
} from './seasonsCore';

export * from './seasonsCore';

export interface ActiveSeasonData {
  season: Season | null;
  countdown: SeasonCountdown | null;
  banners: AnnouncementBanner[];
}

/**
 * Fetches the currently active season and live announcement banners
 */
export async function fetchActiveSeasonAndBanners(): Promise<{
  success: boolean;
  data: ActiveSeasonData;
  error?: string;
}> {
  const fallbackData: ActiveSeasonData = {
    season: {
      id: 'default-season-1',
      number: 1,
      name: 'Season 1: First Infiltration',
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      is_active: true,
    },
    countdown: {
      daysRemaining: 30,
      hoursRemaining: 0,
      label: 'Season ends in 30 days',
      isEnded: false,
    },
    banners: [],
  };

  if (!supabase) {
    return { success: true, data: fallbackData };
  }

  try {
    const { data, error } = await supabase.rpc('get_active_season_and_banners');

    if (error || !data) {
      // Return tactical default if table/rpc isn't provisioned yet
      return { success: true, data: fallbackData };
    }

    const season = data.season ? (data.season as Season) : null;
    const banners = Array.isArray(data.banners) ? (data.banners as AnnouncementBanner[]) : [];
    const countdown = season ? calculateSeasonCountdown(season.ends_at) : null;

    return {
      success: true,
      data: {
        season,
        countdown,
        banners: filterActiveBanners(banners),
      },
    };
  } catch (err: any) {
    return { success: true, data: fallbackData };
  }
}
