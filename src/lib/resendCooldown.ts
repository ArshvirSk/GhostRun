import AsyncStorage from '@react-native-async-storage/async-storage';

import { createResendCooldownStore } from './resendCooldownCore';

const store = createResendCooldownStore(AsyncStorage);

/** Remaining cooldown deadline for an email, or 0 when a resend is allowed. */
export const getResendCooldown = store.get;

/** Stores a deadline and drops entries that have already expired. */
export const setResendCooldown = store.set;
