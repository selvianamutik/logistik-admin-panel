import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  extra?.apiBaseUrl ||
  'https://app-ten-gamma-49.vercel.app';

export const TRACKING_TASK_NAME = 'logistik-driver-background-tracking';
