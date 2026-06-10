# Bug Documentation Rules

## Overview
Standardized rules for documenting bugs found during UAT to ensure consistency, completeness, and actionability.

---

## Bug Report Structure

### Required Components

Every bug report MUST include:

1. **Bug ID** - Unique identifier
2. **Summary** - One-line description
3. **Module/Feature** - Which part of system
4. **Severity** - Impact level
5. **Priority** - Urgency level
6. **Status** - Current state
7. **Steps to Reproduce** - Detailed steps
8. **Expected Behavior** - What should happen
9. **Actual Behavior** - What actually happens
10. **Evidence** - Screenshots, videos, logs
11. **Environment** - Browser, OS, URL, role
12. **Reporter Information** - Who found it, when

### Optional but Recommended

- **Related Test Case** - Link to test case that found bug
- **Code Analysis** - Suspected file and line number
- **Suggested Fix** - Proposed solution
- **Workaround** - Temporary solution if available
- **Related Bugs** - Similar or duplicate issues
- **Business Impact** - Effect on operations

---

## Bug ID Convention

### Format
```
BUG-[MODULE]-[NUMBER]
```

### Module Codes

```
ORD = Order / Resi
TRP = Trip
SJ  = Surat Jalan
DO  = Delivery Order (Trip Lama)
INV = Invoice
CUS = Customer
SUP = Supplier
FLT = Fleet (Armada)
VEH = Vehicle (Kendaraan)
DRV = Driver (Supir)
MNT = Maintenance
TIR = Tire (Ban)
INC = Incident (Insiden)
WHS = Warehouse (Gudang)
PUR = Purchase (Pembelian)
ITM = Item (Barang Gudang)
VOU = Voucher (Uang Jalan)
ACC = Accounting (Akuntansi)
USR = User Management
RBAC = Role & Access Control
MOB = Mobile Responsive
API = API / Backend
UI  = General UI/UX
```

### Examples
```
BUG-ORD-001 = First bug in Order module
BUG-TRP-015 = Bug #15 in Trip module
BUG-MOB-003 = Mobile responsive bug #3
```

### Numbering Rules
- Start from 001 for each module
- Increment sequentially
- Don't reuse numbers (even if bug closed)
- Keep running count per module

---

## Severity Levels

### 🔴 Critical

**Definition:**
Bug that causes severe impact on system functionality, data integrity, or security.

**Criteria:**
- System crash or completely unavailable
- Data loss or corruption
- Security vulnerability exposed
- Financial calculation error
- Cannot proceed with core business workflow
- Affects all or most users

**Examples:**
- Database records being deleted unexpectedly
- Login system not working
- Invoice calculations completely wrong
- Customer data exposed to wrong users
- Payment processing fails for all transactions

**Response Time:** Immediate (within 1 hour)

---

### 🟠 High

**Definition:**
Bug that significantly impacts functionality but system remains partially usable.

**Criteria:**
- Major feature completely broken
- Core workflow severely affected
- No practical workaround available
- Affects many users
- Blocks important operations
- Data integrity at risk

**Examples:**
- Cannot create new orders (but can view existing)
- Trip status not updating correctly
- Invoice cannot be generated for delivered orders
- Search functionality not working
- Required validation missing on critical forms

**Response Time:** Same day

---

### 🟡 Medium

**Definition:**
Bug that affects functionality but has workaround or affects limited scope.

**Criteria:**
- Feature partially works
- Workaround exists (though inconvenient)
- Affects some users or specific scenarios
- Non-critical feature broken
- UI/UX significantly degraded
- Minor data inconsistency

**Examples:**
- Filter returns incorrect results but can use search
- Badge not displaying but data is correct
- Export to Excel missing some columns
- Date picker buggy but can type date manually
- Loading state not showing but action completes

**Response Time:** Within 2-3 days

---

### 🟢 Low

**Definition:**
Minor bug with minimal impact on functionality.

**Criteria:**
- Cosmetic/visual issue only
- Affects rare edge cases
- Very easy workaround
- Minimal user impact
- Nice-to-have improvements
- Documentation issues

**Examples:**
- Text alignment slightly off
- Tooltip has typo
- Hover color not ideal
- Spacing inconsistent
- Icon size too small
- Console warning (not error)

**Response Time:** Include in next sprint

---

## Priority Levels

### 🔥 Urgent (Must Fix)
- Blocking release or deployment
- Critical severity bugs
- Regulatory/compliance requirement
- Customer-facing issue

### ⬆️ High (Should Fix)
- High severity bugs
- Blocks important testing
- Affects core workflows
- Multiple users impacted

### ➡️ Normal (Can Wait)
- Medium severity bugs
- Enhancement requests
- Non-blocking issues
- Single user/scenario affected

### ⬇️ Low (Nice to Have)
- Low severity bugs
- Cosmetic improvements
- Edge cases
- Future considerations

**Note:** Severity ≠ Priority
- Critical severity usually = Urgent priority
- But low severity might be high priority if affects many users

---

## Bug Status Lifecycle

```
🆕 New
   ↓
🔍 Triaged (reviewed by team)
   ↓
✅ Confirmed (reproduced and accepted)
   ↓
👤 Assigned (developer assigned)
   ↓
🔧 In Progress (being fixed)
   ↓
🧪 Ready for Testing (fix deployed to test env)
   ↓
✔️ Verified (fix confirmed working)
   ↓
🎉 Closed (complete)

Alternate paths:
❌ Rejected (not a bug / won't fix)
📋 Duplicate (same as another bug)
⏸️ Deferred (will fix later)
```

### Status Definitions

**🆕 New**
- Just reported
- Awaiting team review
- Not yet assigned

**🔍 Triaged**
- Reviewed by tech lead
- Severity/priority confirmed
- Awaiting assignment

**✅ Confirmed**
- Developer reproduced issue
- Accepted as valid bug
- Planning fix

**👤 Assigned**
- Developer assigned
- In their queue
- Not started yet

**🔧 In Progress**
- Developer actively working
- Fix in development
- May need clarifications

**🧪 Ready for Testing**
- Fix deployed to test environment
- Ready for verification
- Awaiting QA/UAT

**✔️ Verified**
- Fix confirmed working
- Re-testing passed
- Ready to close

**🎉 Closed**
- Complete and verified
- Deployed to production (if applicable)
- No further action needed

**❌ Rejected**
- Not a bug (working as designed)
- Cannot reproduce
- Won't fix (out of scope)

**📋 Duplicate**
- Same as existing bug
- Link to original bug

**⏸️ Deferred**
- Valid bug but low priority
- Will fix in future release
- Not blocking current work

---

## Steps to Reproduce Format

### Good Example ✅

```markdown
## Steps to Reproduce

1. Login as OWNER role
   - URL: https://staging.company.com/login
   - Email: owner@company.local
   - Password: [provided separately]

2. Navigate to Order / Resi menu
   - Click "Order / Resi" in sidebar
   - Wait for page to load
   - URL should be: /orders

3. Locate order with SJ
   - Find order ID: ORD-20240120-001
   - Look at "Dokumen" column
   - Should see: "1 Trip | 3 SJ"
   - Should see SJ numbers: SJ-001-A, SJ-001-B, SJ-001-C

4. Attempt to click SJ number
   - Hover mouse over "SJ-001-A"
   - Observe cursor (should be pointer, but is default)
   - Click on "SJ-001-A"
   - Observe: nothing happens

5. Compare with Trip page
   - Navigate to Trip menu
   - Find trip with SJ
   - Observe: SJ numbers ARE clickable here
```

### Bad Example ❌

```markdown
## Steps to Reproduce

1. Go to orders
2. Click on SJ
3. Nothing happens
```

**Problems:**
- Not specific (which order?)
- Missing role information
- Missing expected vs actual
- Cannot reproduce from these steps

---

## Expected vs Actual Format

### Clear Structure

```markdown
## Expected Behavior

✅ What should happen:
- SJ number "SJ-001-A" should display as clickable link
- Link should have blue color (--color-primary)
- Cursor should change to pointer on hover
- Clicking should navigate to /surat-jalan/[sj-id]
- SJ detail page should load with correct data
- Breadcrumb should show: Orders → [Order ID] → SJ-001-A

## Actual Behavior

❌ What actually happens:
- SJ number displays as plain text (not link)
- No color styling (default black text)
- Cursor remains default (not pointer)
- Clicking does nothing (no navigation)
- Cannot access SJ detail from order list
- Must go to order detail first, then click SJ
```

### Use Comparisons

```markdown
## Expected (How it works in Trip page)
[Screenshot of working SJ links in Trip page]

## Actual (How it's broken in Order page)
[Screenshot of non-working SJ text in Order page]
```

---

## Evidence Requirements

### Screenshots

**Must capture:**
- [ ] Full browser window (include URL bar)
- [ ] Error state or incorrect behavior
- [ ] Console tab if errors present
- [ ] Network tab if API issue
- [ ] Timestamp visible (if possible)

**Best practices:**
- Use arrows or highlights to point out issue
- Include before/after if showing change
- Capture multiple states if relevant
- Don't crop out important context

### Console Logs

**What to capture:**
- Red error messages (always)
- Yellow warnings (if relevant)
- Failed network requests
- Stack traces

**Format:**
```
Console Errors:

Uncaught TypeError: Cannot read properties of undefined (reading 'id')
    at renderOrderDocumentSummary (page.tsx:52:18)
    at OrdersPage (page.tsx:145:10)
    ...
```

### Network Tab

**When to capture:**
- API requests failing (404, 500 errors)
- Slow loading times
- Unexpected API calls
- Data not loading

**What to show:**
- Request URL
- Status code
- Response (if error message)
- Request payload (if relevant)

### Video Recording

**When needed:**
- Complex reproduction steps
- Intermittent bugs
- Animation or timing issues
- Workflow demonstrations

**Guidelines:**
- 30-60 seconds max
- Narrate actions if possible
- Show mouse cursor
- Upload to Loom/CloudApp and link

---

## Environment Details

### Required Information

```markdown
## Environment

**Application:**
- URL: https://staging.company.com
- Version: v2.5.3 (check footer or about page)
- Environment: Staging / Production

**User:**
- Role: OWNER
- User ID: usr_abc123 (if known)
- Permissions: Full access

**Browser:**
- Name: Chrome
- Version: 120.0.6099.109
- OS: Windows 11 Pro
- Screen Resolution: 1920x1080

**Date/Time:**
- Date: 2024-01-20
- Time: 14:35 WIB
- Timezone: Asia/Jakarta

**Network:**
- Connection: Office WiFi / Mobile 4G / etc
- Speed: Normal / Slow
```

---

## Impact Assessment

### User Impact

```markdown
## Impact Assessment

**Who is affected:**
- All users with OWNER role
- All users with OPERASIONAL role
- Approximately 15 active users

**What is affected:**
- Order list page navigation
- SJ detail access workflow
- Daily operations (checking SJ status)

**Frequency:**
- Occurs 100% of the time
- Affects every order with SJ
- Reproducible consistently

**Workaround:**
- Navigate to order detail first
- Then click SJ from detail page
- Adds 2 extra clicks per SJ check
- Approximately 50 SJ checks per day

**Business Impact:**
- Reduced productivity (extra clicks)
- User frustration
- Inconsistent UX (works in Trip, not in Order)
- No data loss or financial impact
```

---

## Code Analysis Section

### When to Include

Include code analysis if:
- You can identify suspected file
- You see console error with file reference
- You understand the technical issue
- You can propose a fix

### Format

```markdown
## Code Analysis

### Suspected File
`src/app/(admin)/orders/page.tsx`

### Suspected Lines
Lines 351-357 (Desktop table)
Lines 456-460 (Mobile view)

### Issue Description
Function `renderOrderDocumentSummary()` returns SJ count but not individual SJ data. Type `OrderDocumentSummary` doesn't include SJ details needed for links.

### Current Code (Problematic)
```typescript
// Line 44-56
function renderOrderDocumentSummary(summary?: OrderDocumentSummary) {
  return (
    <div>
      <div>{summary.tripCount} Trip | {summary.sjCount} SJ</div>
      {/* No individual SJ numbers rendered */}
    </div>
  );
}
```

### Root Cause
1. Type `OrderDocumentSummary` missing SJ details
2. Data builder doesn't extract individual SJ
3. Render function doesn't create Link components

### Suggested Fix
1. Add `suratJalans: Array<{id, number}>` to type
2. Extract SJ from `deliveryOrder.shipperReferences`
3. Map SJ to `<Link>` components in render

### Reference
Working implementation exists in Trip page:
- File: `src/app/(admin)/trips/page.tsx`
- Lines: ~250-260
- Pattern can be copied
```

---

## Related Information

### Linking

```markdown
## Related Information

**Test Case:**
- TC-ORD-101: Click SJ Number - Happy Path
- Link: [Notion test case]

**Related Bugs:**
- Similar to: BUG-TRIP-005 (Fixed - SJ links in Trip page)
- May be related to: BUG-DO-012 (Navigation issues)

**Blocks:**
- TC-ORD-102: Cannot test multiple SJ navigation
- TC-ORD-104: Cannot test role-based SJ access

**User Story:**
- US-015: As an operator, I want to quickly view SJ details from order list

**Documentation:**
- UAT Checklist: Section 1.2 - Navigation from List
- Requirement Doc: Page 12 - Order List Features
```

---

## Template: Complete Bug Report

```markdown
# 🐛 BUG-XXX-NNN: [One-line Summary]

**Reporter:** [Your Name]
**Report Date:** 2024-01-20 14:35 WIB
**Status:** 🆕 New
**Severity:** 🟠 High
**Priority:** ⬆️ High
**Module:** [Module Name]
**Feature:** [Feature Name]

---

## 📌 Summary

[2-3 sentences describing the bug clearly]

---

## 🔍 Steps to Reproduce

1. [Detailed step with specific values]
2. [Next step with expected state]
3. [Action that triggers bug]
4. [Observe the issue]

---

## ✅ Expected Behavior

- ✅ [What should happen step 1]
- ✅ [What should happen step 2]
- ✅ [Final expected state]

---

## ❌ Actual Behavior

- ❌ [What actually happens]
- ❌ [Incorrect state or error]
- ❌ [Impact on user]

---

## 🖼️ Evidence

### Screenshot 1: [Description]
![Screenshot description](image-url)
[Annotation: Arrow pointing to issue]

### Screenshot 2: Console Errors
![Console errors](image-url)

### Video Recording
[Loom link: Full reproduction]

### Console Log
```
[Paste console errors here]
```

---

## 🖥️ Environment

**Application:**
- URL: [Test environment URL]
- Version: [Version number]
- Environment: Staging

**User:**
- Role: [User role]
- User ID: [If known]

**Browser:**
- Name: Chrome
- Version: 120.0.6099.109
- OS: Windows 11
- Screen: 1920x1080

**Date/Time:**
- Date: 2024-01-20
- Time: 14:35 WIB

---

## 💥 Impact Assessment

**Who is affected:**
[Which users or roles]

**What is affected:**
[Which features or workflows]

**Frequency:**
[How often it occurs]

**Workaround:**
[If any workaround exists]

**Business Impact:**
[Effect on operations]

---

## 🔧 Code Analysis (Optional)

### Suspected File
`path/to/file.tsx`

### Issue Description
[Technical explanation]

### Current Code
```typescript
// Problematic code
```

### Suggested Fix
```typescript
// Proposed solution
```

---

## 🔗 Related Information

**Test Case:** TC-XXX-NNN
**Related Bugs:** BUG-XXX-NNN
**Blocks:** TC-XXX-NNN
**User Story:** US-XXX

---

## 📝 Additional Notes

[Any other relevant information]

---

## ✍️ Audit Trail

| Date | Action | By | Note |
|------|--------|-----|------|
| 2024-01-20 14:35 | Created | [Your name] | Initial report |
| - | Triaged | - | - |
| - | Assigned | - | - |
| - | Fixed | - | - |
| - | Verified | - | - |
| - | Closed | - | - |

---
```

---

## Quality Checklist

Before submitting bug report:

- [ ] Bug ID follows naming convention
- [ ] Summary is clear and concise (< 100 chars)
- [ ] Severity appropriately assigned
- [ ] Priority appropriate for severity
- [ ] Steps to reproduce are detailed and specific
- [ ] Expected vs Actual clearly explained
- [ ] At least 2 screenshots attached
- [ ] Console errors captured (if any)
- [ ] Environment details complete
- [ ] Impact assessment included
- [ ] Test case linked
- [ ] Tried to reproduce 2-3 times
- [ ] Checked if already reported

---

## Common Mistakes to Avoid

### ❌ Vague Description
```
Bad: "Button doesn't work"
Good: "Submit button on Order form does not save data when clicked"
```

### ❌ Missing Steps
```
Bad: "Error appears"
Good: "After clicking Save on line 3 of form, error message 'Invalid date' appears below date field"
```

### ❌ No Evidence
```
Bad: [Bug description with no screenshots]
Good: [Bug description + before/after screenshots + console log]
```

### ❌ Wrong Severity
```
Bad: Marking cosmetic issue as Critical
Good: Visual alignment issue = Low severity
```

### ❌ Assumptions
```
Bad: "Probably a database issue"
Good: "API returns 500 error. Response: {error: 'Database connection failed'}"
```

---

## Success Criteria

A good bug report enables developer to:
- ✅ Understand the issue immediately
- ✅ Reproduce the bug reliably
- ✅ Assess impact and priority
- ✅ Locate the problematic code
- ✅ Implement and test a fix
- ✅ Verify the fix resolves the issue

---

**Follow these rules for consistent, high-quality bug documentation!**