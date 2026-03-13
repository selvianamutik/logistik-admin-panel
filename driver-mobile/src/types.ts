export type DriverUser = {
  _id: string;
  name: string;
  email: string;
  role: 'DRIVER';
  driverRef?: string;
  driverName?: string;
};

export type Driver = {
  _id: string;
  name: string;
  phone: string;
  active: boolean;
};

export type CompanySummary = {
  _id: string;
  name: string;
  phone?: string;
  themeColor?: string;
} | null;

export type DeliveryOrder = {
  _id: string;
  doNumber: string;
  masterResi?: string;
  customerName?: string;
  receiverAddress?: string;
  vehiclePlate?: string;
  driverName?: string;
  date: string;
  status: 'CREATED' | 'ON_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  trackingState?: 'IDLE' | 'ACTIVE' | 'PAUSED' | 'STOPPED';
  trackingStartedAt?: string;
  trackingStoppedAt?: string;
  trackingLastSeenAt?: string;
  trackingLastLat?: number;
  trackingLastLng?: number;
  trackingLastAccuracyM?: number;
  trackingLastSpeedKph?: number;
};

export type DriverSessionPayload = {
  user: DriverUser;
  driver: Driver;
  company: CompanySummary;
};

export type DriverLoginPayload = DriverSessionPayload & {
  success: true;
  token: string;
  expiresIn: number;
};

export type TrackingAction = 'start' | 'heartbeat' | 'pause' | 'resume' | 'stop';

export type ActiveTrackingContext = {
  deliveryOrderRef: string;
};
