import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ActiveTrackingContext } from './types';

const AUTH_TOKEN_KEY = 'logistik-driver-auth-token';
const ACTIVE_TRACKING_KEY = 'logistik-driver-active-tracking';

export async function getAuthToken() {
  return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function setAuthToken(token: string) {
  await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
}

export async function clearAuthToken() {
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function getActiveTrackingContext(): Promise<ActiveTrackingContext | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_TRACKING_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ActiveTrackingContext;
  } catch {
    await AsyncStorage.removeItem(ACTIVE_TRACKING_KEY);
    return null;
  }
}

export async function setActiveTrackingContext(context: ActiveTrackingContext) {
  await AsyncStorage.setItem(ACTIVE_TRACKING_KEY, JSON.stringify(context));
}

export async function clearActiveTrackingContext() {
  await AsyncStorage.removeItem(ACTIVE_TRACKING_KEY);
}
