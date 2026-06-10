# Code Fix Pattern Rules

## Overview
Established patterns and best practices for implementing code fixes in the Next.js application.

---

## Before You Start Fixing

### 1. Understand the Context

**Read the surrounding code:**
- [ ] Understand the component/function purpose
- [ ] Check how data flows in and out
- [ ] Look for similar patterns in codebase
- [ ] Review type definitions
- [ ] Check related functions

**Trace the data flow:**
```
User Action → Event Handler → API Call → Server Action → Database → Response → UI Update
```

**Ask yourself:**
- Why does this code exist?
- What problem does it solve?
- What are the dependencies?
- What could break if I change this?
- Are there similar patterns elsewhere?

### 2. Plan Your Fix

**Don't jump straight to coding:**
- [ ] Identify root cause (not just symptoms)
- [ ] Consider side effects
- [ ] Think about edge cases
- [ ] Plan testing approach
- [ ] Check if fix affects other modules

**Document your plan:**
```markdown
## Fix Plan for BUG-XXX-NNN

1. Root cause: [What's actually wrong]
2. Files to change: [List]
3. Approach: [High-level strategy]
4. Side effects: [What else might be affected]
5. Testing: [How to verify]
```

---

## Common Fix Patterns

### Pattern 1: Add Client-Side Validation

**Use case:** Form submits with invalid data

```typescript
// ❌ BEFORE: No validation
'use client'

export function OrderForm() {
  async function handleSubmit(formData: FormData) {
    const result = await createOrder(formData);
    // User sees error only after server rejects
  }
  
  return <form action={handleSubmit}>...</form>;
}

// ✅ AFTER: With validation
'use client'

import { useState } from 'react';
import { useToast } from '../layout';

interface ValidationErrors {
  [key: string]: string;
}

export function OrderForm() {
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { addToast } = useToast();

  // Validation function
  function validateForm(formData: FormData): ValidationErrors {
    const errors: ValidationErrors = {};
    
    const customerName = formData.get('customerName') as string;
    if (!customerName?.trim()) {
      errors.customerName = 'Nama customer wajib diisi';
    }
    
    const pickupAddress = formData.get('pickupAddress') as string;
    if (!pickupAddress?.trim()) {
      errors.pickupAddress = 'Alamat pickup wajib diisi';
    } else if (pickupAddress.length < 10) {
      errors.pickupAddress = 'Alamat pickup minimal 10 karakter';
    }
    
    return errors;
  }

  async function handleSubmit(formData: FormData) {
    // 1. Validate before submit
    const validationErrors = validateForm(formData);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return; // Stop submission
    }
    
    // 2. Clear errors and show loading
    setErrors({});
    setIsSubmitting(true);
    
    try {
      const result = await createOrder(formData);
      
      if (result.error) {
        addToast('error', result.error);
        return;
      }
      
      addToast('success', 'Order berhasil dibuat');
      window.location.href = `/orders/${result.data.id}`;
    } catch (error) {
      console.error('Create order failed:', error);
      addToast('error', 'Gagal membuat order. Silakan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit}>
      <div>
        <label>Nama Customer</label>
        <input 
          name="customerName" 
          className={errors.customerName ? 'input-error' : ''}
        />
        {errors.customerName && (
          <p className="error-message">{errors.customerName}</p>
        )}
      </div>
      
      <div>
        <label>Alamat Pickup</label>
        <textarea 
          name="pickupAddress"
          className={errors.pickupAddress ? 'input-error' : ''}
        />
        {errors.pickupAddress && (
          <p className="error-message">{errors.pickupAddress}</p>
        )}
      </div>
      
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Menyimpan...' : 'Simpan Order'}
      </button>
    </form>
  );
}
```

**Key points:**
- Validate before API call (instant feedback)
- Show inline errors next to fields
- Disable button during submission
- Handle both client and server errors
- Show loading state

---

### Pattern 2: Add Server-Side Validation

**Use case:** Prevent invalid data from reaching database

```typescript
// ❌ BEFORE: No server validation
'use server'

export async function createOrder(data: OrderInput) {
  // Directly insert without validation
  const order = await db.insert('orders', data);
  return { data: order };
}

// ✅ AFTER: With server validation
'use server'

import { getServerSession } from '@/lib/session';
import { createAuditLog } from '@/lib/audit';

interface ValidationResult {
  success: boolean;
  errors?: Record<string, string>;
}

function validateOrderInput(data: OrderInput): ValidationResult {
  const errors: Record<string, string> = {};
  
  // Required fields
  if (!data.customerName?.trim()) {
    errors.customerName = 'Customer name is required';
  }
  
  if (!data.serviceRef) {
    errors.serviceRef = 'Service type is required';
  }
  
  // Format validation
  const plateRegex = /^[A-Z]{1,2}\s\d{1,4}\s[A-Z]{1,3}$/;
  if (data.vehiclePlate && !plateRegex.test(data.vehiclePlate)) {
    errors.vehiclePlate = 'Invalid plate number format';
  }
  
  // Business rules
  if (data.items && data.items.length === 0) {
    errors.items = 'Order must have at least one item';
  }
  
  return {
    success: Object.keys(errors).length === 0,
    errors: Object.keys(errors).length > 0 ? errors : undefined
  };
}

export async function createOrder(data: OrderInput) {
  // 1. Get session
  const session = await getServerSession();
  if (!session?.user) {
    return { error: 'Unauthorized', code: 'UNAUTHORIZED' };
  }
  
  // 2. Check permissions
  if (!hasPermission(session.user.role, 'CREATE_ORDER')) {
    return { error: 'Forbidden', code: 'FORBIDDEN' };
  }
  
  // 3. Validate input
  const validation = validateOrderInput(data);
  if (!validation.success) {
    return { 
      error: 'Validation failed', 
      code: 'VALIDATION_ERROR',
      validationErrors: validation.errors 
    };
  }
  
  // 4. Sanitize data
  const sanitized = {
    ...data,
    customerName: data.customerName.trim(),
    pickupAddress: data.pickupAddress?.trim(),
    // Remove any unexpected fields
  };
  
  try {
    // 5. Insert to database
    const order = await db.insert('orders', {
      ...sanitized,
      createdBy: session.user.id,
      createdAt: new Date().toISOString(),
    });
    
    // 6. Create audit log
    await createAuditLog({
      userId: session.user.id,
      action: 'CREATE_ORDER',
      entityType: 'ORDER',
      entityId: order.id,
      changes: sanitized,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    
    return { data: order };
  } catch (error) {
    console.error('Failed to create order:', error);
    return { 
      error: 'Failed to create order', 
      code: 'DATABASE_ERROR' 
    };
  }
}
```

**Key points:**
- Always validate on server (client validation can be bypassed)
- Check authentication and authorization
- Sanitize input data
- Create audit logs for mutations
- Return structured errors
- Handle database errors gracefully

---

### Pattern 3: Add Missing Links/Navigation

**Use case:** Text should be clickable link

```typescript
// ❌ BEFORE: Plain text
<td>
  <span>{order.suratJalanNumber}</span>
</td>

// ✅ AFTER: Clickable link
import Link from 'next/link';

<td>
  <Link 
    href={`/surat-jalan/${order.suratJalanId}`}
    className="sj-link"
    style={{ color: 'var(--color-primary)' }}
  >
    {order.suratJalanNumber}
  </Link>
</td>
```

**CSS for links:**
```css
.sj-link {
  color: var(--color-primary);
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.sj-link:hover {
  text-decoration: underline;
  cursor: pointer;
}
```

**Key points:**
- Use Next.js `Link` component (not `<a>`)
- Use primary color for links
- Add hover state
- Use monospace font for IDs/numbers

---

### Pattern 4: Fix Null/Undefined Errors

**Use case:** "Cannot read property 'X' of undefined"

```typescript
// ❌ BEFORE: No null checks
function getUserEmail(user: User) {
  return user.profile.email; // Crashes if profile is null
}

// ✅ AFTER: With null checks
function getUserEmail(user: User | null | undefined): string | null {
  if (!user) return null;
  if (!user.profile) return null;
  return user.profile.email || null;
}

// ✅ BETTER: Using optional chaining
function getUserEmail(user: User | null | undefined): string | null {
  return user?.profile?.email ?? null;
}

// ✅ BEST: With type guard
function hasProfile(user: User): user is User & { profile: UserProfile } {
  return user.profile !== null && user.profile !== undefined;
}

function getUserEmail(user: User | null | undefined): string | null {
  if (!user || !hasProfile(user)) return null;
  return user.profile.email; // TypeScript knows profile exists
}
```

**Key points:**
- Always check for null/undefined
- Use optional chaining (`?.`)
- Use nullish coalescing (`??`)
- Define proper types (avoid `any`)
- Create type guards for complex checks

---

### Pattern 5: Handle Async Errors

**Use case:** Promise rejection not caught

```typescript
// ❌ BEFORE: No error handling
async function loadData() {
  const data = await fetch('/api/data').then(r => r.json());
  setData(data);
}

// ✅ AFTER: Proper error handling
async function loadData() {
  try {
    const response = await fetch('/api/data');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    setData(data);
    setError(null);
  } catch (error) {
    console.error('Failed to load data:', error);
    setError(error instanceof Error ? error.message : 'Failed to load data');
    addToast('error', 'Gagal memuat data. Silakan refresh halaman.');
  } finally {
    setLoading(false);
  }
}
```

**Key points:**
- Always use try-catch with async/await
- Check response.ok before parsing
- Set error state for UI feedback
- Log errors to console
- Show user-friendly messages
- Clean up in finally block

---

### Pattern 6: Fix Race Conditions

**Use case:** Multiple rapid clicks cause duplicate actions

```typescript
// ❌ BEFORE: No protection
function DeleteButton({ id }: { id: string }) {
  async function handleDelete() {
    await deleteOrder(id);
    refresh();
  }
  
  return <button onClick={handleDelete}>Delete</button>;
}

// ✅ AFTER: With loading state
function DeleteButton({ id }: { id: string }) {
  const [isDeleting, setIsDeleting] = useState(false);
  
  async function handleDelete() {
    if (isDeleting) return; // Prevent duplicate clicks
    
    setIsDeleting(true);
    try {
      await deleteOrder(id);
      await refresh();
    } catch (error) {
      console.error('Delete failed:', error);
      addToast('error', 'Gagal menghapus');
    } finally {
      setIsDeleting(false);
    }
  }
  
  return (
    <button 
      onClick={handleDelete} 
      disabled={isDeleting}
    >
      {isDeleting ? 'Menghapus...' : 'Delete'}
    </button>
  );
}
```

**Key points:**
- Track loading state
- Disable button during operation
- Check if already processing
- Show loading indicator
- Clean up state in finally

---

### Pattern 7: Add Loading States

**Use case:** No feedback during async operations

```typescript
// ❌ BEFORE: No loading state
'use client'

export function DataTable() {
  const [data, setData] = useState([]);
  
  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(setData);
  }, []);
  
  return (
    <table>
      {data.map(item => <tr key={item.id}>...</tr>)}
    </table>
  );
}

// ✅ AFTER: With loading state
'use client'

export function DataTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch('/api/data');
        if (!response.ok) throw new Error('Failed to load');
        
        const result = await response.json();
        setData(result.data || []);
      } catch (err) {
        console.error('Load failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    
    void loadData();
  }, []);
  
  if (loading) {
    return (
      <div className="loading-skeleton">
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton-row" />
        ))}
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="error-state">
        <p>Gagal memuat data: {error}</p>
        <button onClick={() => window.location.reload()}>
          Coba Lagi
        </button>
      </div>
    );
  }
  
  if (data.length === 0) {
    return (
      <div className="empty-state">
        <p>Tidak ada data</p>
      </div>
    );
  }
  
  return (
    <table>
      {data.map(item => <tr key={item.id}>...</tr>)}
    </table>
  );
}
```

**Key points:**
- Show loading skeletons
- Handle error states
- Show empty states
- Provide retry mechanism
- Clean up loading state

---

### Pattern 8: Fix Type Errors

**Use case:** TypeScript compilation errors

```typescript
// ❌ BEFORE: Type errors
function processOrder(order: any) {
  return order.id; // 'any' type
}

// ✅ AFTER: Proper types
interface Order {
  id: string;
  customerName: string;
  status: 'OPEN' | 'PARTIAL' | 'COMPLETE' | 'CANCELLED';
  items?: OrderItem[];
  createdAt: string;
}

interface OrderItem {
  id: string;
  description: string;
  quantity: number;
}

function processOrder(order: Order): string {
  return order.id;
}

// ✅ BETTER: With null safety
function processOrder(order: Order | null | undefined): string | null {
  if (!order) return null;
  return order.id;
}

// ✅ BEST: With type guard
function isValidOrder(order: unknown): order is Order {
  return (
    typeof order === 'object' &&
    order !== null &&
    'id' in order &&
    typeof order.id === 'string'
  );
}

function processOrder(order: unknown): string | null {
  if (!isValidOrder(order)) return null;
  return order.id; // TypeScript knows this is Order
}
```

**Key points:**
- Define proper interfaces
- Avoid `any` type
- Use union types for null/undefined
- Create type guards
- Use const assertions

---

## Next.js Specific Patterns

### Server Actions

```typescript
// ✅ Server Action Pattern
'use server'

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createOrder(formData: FormData) {
  // 1. Get session
  const session = await getServerSession();
  if (!session) return { error: 'Unauthorized' };
  
  // 2. Validate
  const validation = validate(formData);
  if (!validation.success) {
    return { error: 'Invalid data', errors: validation.errors };
  }
  
  // 3. Process
  const order = await db.insert('orders', validation.data);
  
  // 4. Audit
  await createAuditLog({ ... });
  
  // 5. Revalidate cache
  revalidatePath('/orders');
  
  // 6. Redirect (throws)
  redirect(`/orders/${order.id}`);
}
```

### Client Components

```typescript
// ✅ Client Component Pattern
'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function OrderForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();
  
  async function handleSubmit(formData: FormData) {
    setLoading(true);
    try {
      const result = await createOrder(formData);
      if (result.error) {
        addToast('error', result.error);
        return;
      }
      addToast('success', 'Order created');
      router.push(`/orders/${result.id}`);
      router.refresh(); // Revalidate server components
    } catch (error) {
      console.error(error);
      addToast('error', 'Failed to create order');
    } finally {
      setLoading(false);
    }
  }
  
  return <form action={handleSubmit}>...</form>;
}
```

---

## Testing Your Fix

### Before Committing

**Manual Testing:**
- [ ] Original bug is fixed
- [ ] No console errors
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] Tested happy path
- [ ] Tested edge cases
- [ ] Tested with different roles
- [ ] Tested on mobile
- [ ] Tested in different browsers

**Regression Testing:**
- [ ] Related features still work
- [ ] Navigation still works
- [ ] Forms still submit
- [ ] Lists still load
- [ ] Filters still work

**Code Quality:**
- [ ] Code follows existing patterns
- [ ] Types are properly defined
- [ ] No `any` types introduced
- [ ] Error handling present
- [ ] Loading states implemented
- [ ] Comments added where needed

---

## Commit Message Format

```
fix(module): Brief description of fix

Fixes BUG-XXX-NNN: Full bug title

- Added validation for X field
- Fixed null pointer exception in Y function
- Updated type definitions for Z

Tested:
- Happy path works
- Edge cases handled
- No regressions found

Related: TC-XXX-NNN (test case)
```

---

## Success Criteria

A good fix:
- ✅ Solves the root cause (not just symptoms)
- ✅ Doesn't break existing functionality
- ✅ Follows established code patterns
- ✅ Handles edge cases
- ✅ Has proper error handling
- ✅ Includes loading states
- ✅ Is type-safe (no `any`)
- ✅ Has been tested thoroughly
- ✅ Is documented appropriately

---

**Follow these patterns for consistent, high-quality fixes!**