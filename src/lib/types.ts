/* ============================================================
   LOGISTIK — Type Definitions
   ============================================================ */

// ── Roles & Auth ──
export type UserRole = 'OWNER' | 'ADMIN';

export interface User {
  _id: string;
  _type: 'user';
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  active: boolean;
  createdAt: string;
}

export interface SessionUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
}

// ── Company Profile ──
export interface CompanyProfile {
  _id: string;
  _type: 'companyProfile';
  name: string;
  address: string;
  phone: string;
  email: string;
  npwp?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  logoUrl?: string;
  headerStampUrl?: string;
  signatureStampUrl?: string;
  numberingSettings: {
    resiPrefix: string;
    resiCounter: number;
    doPrefix: string;
    doCounter: number;
    invoicePrefix: string;
    invoiceCounter: number;
    incidentPrefix: string;
    incidentCounter: number;
  };
  invoiceSettings: {
    defaultTermDays: number;
    dueDateDays: number;
    footerNote: string;
    invoiceMode: 'ORDER' | 'DO';
  };
  documentSettings: {
    showContact: boolean;
    dateFormat: string;
  };
}

// ── Customer ──
export interface Customer {
  _id: string;
  _type: 'customer';
  name: string;
  address: string;
  contactPerson: string;
  phone: string;
  email: string;
  defaultPaymentTerm: number;
  npwp?: string;
  active: boolean;
}

// ── Service ──
export interface Service {
  _id: string;
  _type: 'service';
  name: string;
  description: string;
  active: boolean;
}

// ── Expense Category ──
export interface ExpenseCategory {
  _id: string;
  _type: 'expenseCategory';
  name: string;
  active: boolean;
}

// ── Driver ──
export interface Driver {
  _id: string;
  _type: 'driver';
  name: string;
  phone: string;
  licenseNumber: string;
  active: boolean;
}

// ── Order ──
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'COMPLETE' | 'ON_HOLD' | 'CANCELLED';
export type OrderItemStatus = 'PENDING' | 'ON_DELIVERY' | 'DELIVERED' | 'HOLD' | 'RETURNED';

export interface Order {
  _id: string;
  _type: 'order';
  masterResi: string;
  customerRef: string;
  customerName?: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  receiverCompany?: string;
  pickupAddress?: string;
  serviceRef: string;
  serviceName?: string;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  createdBy: string;
}

export interface OrderItem {
  _id: string;
  _type: 'orderItem';
  orderRef: string;
  description: string;
  qtyKoli: number;
  weight: number;
  volume?: number;
  value?: number;
  status: OrderItemStatus;
}

// ── Delivery Order ──
export type DOStatus = 'CREATED' | 'ON_DELIVERY' | 'DELIVERED' | 'CANCELLED';

export interface DeliveryOrder {
  _id: string;
  _type: 'deliveryOrder';
  doNumber: string;
  orderRef: string;
  masterResi?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  driverRef?: string;
  driverName?: string;
  date: string;
  status: DOStatus;
  notes?: string;
  podReceiverName?: string;
  podReceivedDate?: string;
  podNote?: string;
  podImageUrl?: string;
  customerName?: string;
  receiverName?: string;
  receiverAddress?: string;
}

export interface DeliveryOrderItem {
  _id: string;
  _type: 'deliveryOrderItem';
  deliveryOrderRef: string;
  orderItemRef: string;
  orderItemDescription?: string;
  orderItemQtyKoli?: number;
  orderItemWeight?: number;
}

// ── Tracking Log ──
export interface TrackingLog {
  _id: string;
  _type: 'trackingLog';
  refType: 'DO' | 'ORDER';
  refRef: string;
  status: string;
  note?: string;
  locationText?: string;
  timestamp: string;
  userRef?: string;
  userName?: string;
}

// ── Invoice ──
export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface Invoice {
  _id: string;
  _type: 'invoice';
  invoiceNumber: string;
  mode: 'ORDER' | 'DO';
  orderRef?: string;
  doRef?: string;
  customerRef?: string;
  customerName?: string;
  masterResi?: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  totalAmount: number;
  notes?: string;
}

export interface InvoiceItem {
  _id: string;
  _type: 'invoiceItem';
  invoiceRef: string;
  description: string;
  qty?: number;
  price: number;
  subtotal: number;
}

// ── Payment ──
export type PaymentMethod = 'TRANSFER' | 'CASH' | 'OTHER';

export interface Payment {
  _id: string;
  _type: 'payment';
  invoiceRef: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
  attachmentUrl?: string;
}

// ── Income ──
export interface Income {
  _id: string;
  _type: 'income';
  sourceType: 'INVOICE_PAYMENT' | 'OTHER';
  paymentRef?: string;
  date: string;
  amount: number;
  note?: string;
}

// ── Expense ──
export type PrivacyLevel = 'internal' | 'ownerOnly';

export interface Expense {
  _id: string;
  _type: 'expense';
  categoryRef: string;
  categoryName?: string;
  date: string;
  amount: number;
  note?: string;
  description?: string;
  receiptUrl?: string;
  privacyLevel: PrivacyLevel;
  relatedVehicleRef?: string;
  relatedIncidentRef?: string;
  relatedMaintenanceRef?: string;
}

// ── Vehicle ──
export type VehicleStatus = 'ACTIVE' | 'IN_SERVICE' | 'OUT_OF_SERVICE' | 'SOLD';

export interface Vehicle {
  _id: string;
  _type: 'vehicle';
  unitCode: string;
  plateNumber: string;
  vehicleType: string;
  brandModel: string;
  year: number;
  capacityKg?: number;
  capacityVolume?: number;
  chassisNumber?: string;   // ownerOnly
  engineNumber?: string;    // ownerOnly
  status: VehicleStatus;
  base?: string;
  vehiclePhotoUrl?: string;
  notes?: string;
  lastOdometer?: number;
  lastOdometerAt?: string;
}

// ── Maintenance ──
export type MaintenanceStatus = 'SCHEDULED' | 'DONE' | 'SKIPPED';
export type ScheduleType = 'DATE' | 'ODOMETER';

export interface Maintenance {
  _id: string;
  _type: 'maintenance';
  vehicleRef: string;
  vehiclePlate?: string;
  type: string;
  scheduleType: ScheduleType;
  plannedDate?: string;
  plannedOdometer?: number;
  status: MaintenanceStatus;
  completedDate?: string;
  odometerAtService?: number;
  vendor?: string;
  notes?: string;
  attachmentUrls?: string[];
  relatedExpenseRef?: string;
  cost?: number;
}

// ── Tire Event ──
export type TirePosition = 'FRONT_LEFT' | 'FRONT_RIGHT' | 'REAR_LEFT' | 'REAR_RIGHT' | 'SPARE';
export type TireAction = 'PATCH' | 'REPLACE_NEW' | 'ROTATE' | 'VULCANIZE';
export type TireCause = 'FLAT' | 'BLOWOUT' | 'WORN' | 'NAIL' | 'OTHER';

export interface TireEvent {
  _id: string;
  _type: 'tireEvent';
  vehicleRef: string;
  vehiclePlate?: string;
  date: string;
  odometer: number;
  tirePosition: TirePosition;
  action: TireAction;
  cause?: TireCause;
  notes?: string;
  attachmentUrls?: string[];
  relatedExpenseRef?: string;
}

// ── Incident ──
export type IncidentType = 'BLOWOUT_TIRE' | 'ENGINE_TROUBLE' | 'ACCIDENT_MINOR' | 'ACCIDENT_MAJOR' | 'OTHER';
export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH';
export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Incident {
  _id: string;
  _type: 'incident';
  incidentNumber: string;
  dateTime: string;
  vehicleRef: string;
  vehiclePlate?: string;
  driverRef?: string;
  driverName?: string;
  relatedDeliveryOrderRef?: string;
  relatedDONumber?: string;
  incidentType: IncidentType;
  urgency: Urgency;
  locationText: string;
  odometer: number;
  description: string;
  status: IncidentStatus;
  attachmentUrls?: string[];
  assignedToUserRef?: string;
  assignedToUserName?: string;
}

export interface IncidentActionLog {
  _id: string;
  _type: 'incidentActionLog';
  incidentRef: string;
  timestamp: string;
  note: string;
  userRef?: string;
  userName?: string;
}

// ── Audit Log ──
export interface AuditLog {
  _id: string;
  _type: 'auditLog';
  actorUserRef: string;
  actorUserName?: string;
  action: string;
  entityType: string;
  entityRef?: string;
  changesSummary: string;
  timestamp: string;
}

// ── UI Helpers ──
export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}
