import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { postTrackingAction } from './api';
import { TRACKING_TASK_NAME } from './config';
import {
  clearActiveTrackingContext,
  getActiveTrackingContext,
  getAuthToken,
  setActiveTrackingContext,
} from './storage';

type LocationPoint = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
  };
};

TaskManager.defineTask(TRACKING_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Driver tracking task error', error);
    return;
  }

  const payload = data as { locations?: LocationPoint[] } | undefined;
  const latestPoint = payload?.locations?.[payload.locations.length - 1];
  if (!latestPoint) {
    return;
  }

  const [token, activeTracking] = await Promise.all([getAuthToken(), getActiveTrackingContext()]);
  if (!token || !activeTracking) {
    await stopBackgroundTracking();
    return;
  }

  try {
    await postTrackingAction(token, activeTracking.deliveryOrderRef, 'heartbeat', {
      latitude: latestPoint.coords.latitude,
      longitude: latestPoint.coords.longitude,
      accuracyM: latestPoint.coords.accuracy,
      speedMps: latestPoint.coords.speed,
    });
  } catch (error) {
    console.warn('Driver tracking heartbeat failed', error);
  }
});

export async function requestTrackingPermissions() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    throw new Error('Izin lokasi foreground wajib diaktifkan.');
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    throw new Error('Izin lokasi background wajib diaktifkan agar tracking tetap berjalan saat layar mati.');
  }
}

export async function getCurrentLocation() {
  return Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
  });
}

export async function startBackgroundTracking(deliveryOrderRef: string) {
  await setActiveTrackingContext({ deliveryOrderRef });

  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME);
  if (alreadyRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK_NAME);
  }

  const trackingOptions: Location.LocationTaskOptions = {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 15000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
  };

  if (Platform.OS === 'ios') {
    trackingOptions.showsBackgroundLocationIndicator = true;
    trackingOptions.activityType = Location.ActivityType.AutomotiveNavigation;
  } else {
    trackingOptions.foregroundService = {
      notificationTitle: 'Tracking pengiriman aktif',
      notificationBody: 'Lokasi supir sedang dikirim ke dashboard logistik.',
      notificationColor: '#0f4c81',
      killServiceOnDestroy: false,
    };
  }

  await Location.startLocationUpdatesAsync(TRACKING_TASK_NAME, trackingOptions);
}

export async function stopBackgroundTracking() {
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME);
  if (alreadyRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK_NAME);
  }
  await clearActiveTrackingContext();
}
