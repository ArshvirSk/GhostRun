import { create } from 'zustand';
import { colors } from '../theme/tokens';

export interface SignupState {
  // Step 1: Codename & Color
  name: string;
  color: string;
  setName: (name: string) => void;
  setColor: (color: string) => void;

  // Step 2: Account Credentials
  email: string;
  password: string;
  isGuest: boolean;
  marketingConsent: boolean;
  setEmail: (email: string) => void;
  setPassword: (password: string) => void;
  setIsGuest: (isGuest: boolean) => void;
  setMarketingConsent: (consent: boolean) => void;

  // Step 3: Verification & Cooldown
  cooldownUntil: number;
  setCooldownUntil: (until: number) => void;

  // Step 4: Before You Play (Consents & Permissions)
  ageConfirmed: boolean;
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  notificationsGranted: boolean;
  setAgeConfirmed: (confirmed: boolean) => void;
  setForegroundGranted: (granted: boolean) => void;
  setBackgroundGranted: (granted: boolean) => void;
  setNotificationsGranted: (granted: boolean) => void;

  // Reset
  reset: () => void;
}

const DEFAULT_STATE = {
  name: '',
  color: colors.palette[0],
  email: '',
  password: '',
  isGuest: false,
  marketingConsent: false,
  cooldownUntil: 0,
  ageConfirmed: false,
  foregroundGranted: false,
  backgroundGranted: false,
  notificationsGranted: false,
};

export const useSignupStore = create<SignupState>((set) => ({
  ...DEFAULT_STATE,
  setName: (name) => set({ name }),
  setColor: (color) => set({ color }),
  setEmail: (email) => set({ email }),
  setPassword: (password) => set({ password }),
  setIsGuest: (isGuest) => set({ isGuest }),
  setMarketingConsent: (marketingConsent) => set({ marketingConsent }),
  setCooldownUntil: (cooldownUntil) => set({ cooldownUntil }),
  setAgeConfirmed: (ageConfirmed) => set({ ageConfirmed }),
  setForegroundGranted: (foregroundGranted) => set({ foregroundGranted }),
  setBackgroundGranted: (backgroundGranted) => set({ backgroundGranted }),
  setNotificationsGranted: (notificationsGranted) => set({ notificationsGranted }),
  reset: () => set(DEFAULT_STATE),
}));
