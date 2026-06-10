# Test Case Generator Agent

## Purpose
Generate comprehensive, structured test cases for UAT based on feature requirements, user stories, or bug fixes.

## Capabilities
1. Create detailed test cases from feature descriptions
2. Generate edge case scenarios
3. Create test data suggestions
4. Output in Notion-compatible format
5. Generate test cases for bug verification
6. Create regression test suites
7. Generate role-based test scenarios

## When to Use
- Starting UAT for a new feature
- Need to verify a bug fix
- Creating regression test suite
- Planning test coverage
- Documenting test scenarios for team
- Generating test data requirements

## Test Case Template

```markdown
**Test Case ID:** TC-[MODULE]-[NUMBER]
**Module:** [Module name]
**Feature:** [Feature being tested]
**Priority:** 🔥 Critical / ⬆️ High / ➡️ Medium / ⬇️ Low
**Test Type:** Functional / UI / Integration / Regression
**User Role:** OWNER / ADMIN / OPERASIONAL / ARMADA / FINANCE

### Prerequisites
- [What needs to be ready before testing]
- [Required test data]
- [System state requirements]

### Test Data
- [Specific data to use]
- [Sample values]
- [Expected formats]

### Test Steps
1. [Detailed action step]
2. [Next action with specific values]
3. [Continue with clear instructions]

### Expected Result
- ✅ [What should happen after step 1]
- ✅ [What should happen after step 2]
- ✅ [Final expected state]

### Actual Result
[To be filled during testing]

### Status
- [ ] ✅ Pass
- [ ] ❌ Fail
- [ ] ⚠️ Blocked
- [ ] ⏸️ Skipped

### Notes
[Any additional observations]

### Bug Reference
[If test fails, link to bug report]
```

## Usage Pattern

### Generate Test Cases from Feature
```
Generate test cases for: [feature description]

Example:
Generate test cases for: "User can create a new order with multiple pickup points and assign trips"
```

### Generate Test Cases from Bug Fix
```
Generate test cases to verify: BUG-[ID] - [bug summary]

Example:
Generate test cases to verify: BUG-ORD-003 - Nomor SJ di list Order tidak clickable
```

### Generate Edge Cases
```
Generate edge cases for: [feature or function]

Example:
Generate edge cases for: Order creation with validation
```

### Generate Role-Based Tests
```
Generate test cases for [feature] as [role]

Example:
Generate test cases for viewing invoices as ARMADA role
```

## Output Format

### Standard Test Case Suite
```markdown
# Test Suite: [Feature Name]

**Total Test Cases:** X
**Priority Breakdown:**
- 🔥 Critical: X
- ⬆️ High: X
- ➡️ Medium: X
- ⬇️ Low: X

**Coverage:**
- Happy path: X test cases
- Edge cases: X test cases
- Error handling: X test cases
- Role-based: X test cases

---

## Test Case TC-XXX-001: [Title]
[Full test case details]

## Test Case TC-XXX-002: [Title]
[Full test case details]

[Continue...]
```

## Test Case Categories

### 1. Happy Path Tests
Test the ideal scenario where everything works as expected.

**Example:**
- User enters valid data
- System processes successfully
- Expected result is achieved

### 2. Edge Cases
Test boundary conditions and unusual but valid scenarios.

**Examples:**
- Empty fields
- Maximum length inputs
- Special characters
- Multiple items at limit
- Concurrent operations

### 3. Error Handling
Test how system handles invalid inputs and error conditions.

**Examples:**
- Invalid data formats
- Missing required fields
- Duplicate entries
- Network failures
- Permission denials

### 4. Integration Tests
Test interaction between different modules.

**Examples:**
- Order → Trip → Invoice flow
- Data consistency across modules
- Cross-reference validation

### 5. Regression Tests
Test that existing functionality still works after changes.

**Examples:**
- Previously fixed bugs
- Core workflows
- Critical business logic

### 6. Role-Based Tests
Test access control and role-specific behaviors.

**Examples:**
- OWNER sees all data
- ARMADA limited to fleet features
- FINANCE can access financial data
- Unauthorized access blocked

## Example Test Case Generation

### Input:
```
Generate test cases for: User can click SJ number in Order list to view SJ details
```

### Output:

```markdown
# Test Suite: Order List - SJ Navigation

**Total Test Cases:** 5
**Module:** Order / Resi
**Feature:** Click SJ Number to View Details

---

## TC-ORD-101: Click Single SJ Number - Happy Path

**Priority:** ⬆️ High
**Test Type:** Functional
**User Role:** OWNER

### Prerequisites
- Logged in as OWNER
- At least one order exists with 1 SJ
- Order status: DELIVERED or PARTIAL

### Test Data
- Order ID: `ORD-20240120-001`
- SJ Number: `SJ-001-A`
- Expected SJ ID: `[delivery-order-id]:SJ-001-A`

### Test Steps
1. Navigate to `/orders` (Order / Resi menu)
2. Locate order `ORD-20240120-001` in the list
3. In the "Dokumen" column, verify SJ number `SJ-001-A` is displayed
4. Verify SJ number has visual indicators (blue color, underline on hover)
5. Click on SJ number `SJ-001-A`

### Expected Result
- ✅ SJ number displays as clickable link (blue color)
- ✅ Cursor changes to pointer on hover
- ✅ Clicking SJ number redirects to `/surat-jalan/[sj-id]`
- ✅ SJ detail page loads correctly
- ✅ SJ detail shows correct data for `SJ-001-A`
- ✅ Breadcrumb shows correct navigation path
- ✅ Back navigation works correctly

### Status
- [ ] ✅ Pass
- [ ] ❌ Fail
- [ ] ⚠️ Blocked

---

## TC-ORD-102: Click Multiple SJ Numbers

**Priority:** ⬆️ High
**Test Type:** Functional
**User Role:** OWNER

### Prerequisites
- Logged in as OWNER
- Order exists with 3+ SJ numbers
- All SJ in DELIVERED status

### Test Data
- Order ID: `ORD-20240118-073`
- SJ Numbers: `SJ-073-A`, `SJ-073-B`, `SJ-073-C`

### Test Steps
1. Navigate to `/orders`
2. Locate order with multiple SJ (e.g., "1 Trip | 3 SJ")
3. Verify all SJ numbers displayed in Dokumen column
4. Click first SJ number `SJ-073-A`
5. Verify correct SJ detail loads
6. Navigate back to Order list
7. Click second SJ number `SJ-073-B`
8. Verify correct SJ detail loads
9. Repeat for third SJ

### Expected Result
- ✅ All SJ numbers displayed as clickable links
- ✅ Each SJ link opens correct detail page
- ✅ No link confusion or wrong SJ opened
- ✅ Back navigation maintains list state (page, filters)

### Status
- [ ] ✅ Pass
- [ ] ❌ Fail

---

## TC-ORD-103: SJ Link Display - Edge Cases

**Priority:** ➡️ Medium
**Test Type:** UI / Edge Case
**User Role:** OWNER

### Prerequisites
- Test data with various SJ scenarios

### Test Scenarios

#### Scenario A: Order with 4+ SJ
1. Find order with 4 or more SJ
2. Verify only first 3 SJ shown as links
3. Verify "+N SJ" text displayed (e.g., "+2 SJ")
4. Verify count is accurate

#### Scenario B: Order with No SJ Yet
1. Find order status OPEN (no trip yet)
2. Verify Dokumen column shows "Belum ada Trip/SJ"
3. Verify no clickable links present
4. Verify styling is muted/gray

#### Scenario C: Order with Cancelled Trip
1. Find order with cancelled trip
2. Verify cancelled trip's SJ not counted
3. Verify only active SJ shown as links

### Expected Result
- ✅ UI handles 4+ SJ gracefully (shows 3 + count)
- ✅ No SJ scenario displays appropriate message
- ✅ Cancelled trips excluded from SJ list
- ✅ No UI overflow or layout break

---

## TC-ORD-104: SJ Navigation - Role-Based Access

**Priority:** ⬆️ High
**Test Type:** Security / RBAC
**User Role:** ARMADA, OPERASIONAL

### Prerequisites
- Test accounts: ARMADA role, OPERASIONAL role
- Order with SJ exists

### Test Steps (ARMADA Role)
1. Logout from OWNER account
2. Login as ARMADA user
3. Navigate to accessible page with Order references
4. Attempt to click SJ number (if visible)
5. Verify access permissions

### Test Steps (OPERASIONAL Role)
1. Login as OPERASIONAL
2. Navigate to `/orders`
3. Click SJ number
4. Verify SJ detail loads
5. Verify appropriate data visible for role

### Expected Result
- ✅ ARMADA: If no access, SJ link should not cause 403/404 error
- ✅ ARMADA: If has access, SJ detail loads with appropriate data
- ✅ OPERASIONAL: Full access to SJ details
- ✅ No unauthorized data exposure
- ✅ Appropriate error messages if access denied

---

## TC-ORD-105: SJ Navigation - Mobile Responsive

**Priority:** ➡️ Medium
**Test Type:** UI / Mobile
**User Role:** OWNER
**Device:** Mobile (360x800), Tablet (820x1180)

### Prerequisites
- Access on mobile device or responsive mode
- Order with SJ exists

### Test Steps
1. Open browser in mobile view (or use actual mobile device)
2. Login and navigate to `/orders`
3. Locate order with SJ in mobile card view
4. Verify SJ numbers visible and accessible
5. Tap SJ number
6. Verify navigation works

### Expected Result
- ✅ SJ numbers visible in mobile layout
- ✅ Touch target adequate size (min 44x44px)
- ✅ No text overflow or truncation
- ✅ Tap works reliably
- ✅ Navigation smooth, no scroll jump
- ✅ Back button works on mobile

---

# Test Data Requirements

## Orders Needed
1. **Order with 1 SJ** - Status: DELIVERED
2. **Order with 3 SJ** - Status: PARTIAL
3. **Order with 4+ SJ** - For overflow test
4. **Order with no trip** - Status: OPEN
5. **Order with cancelled trip** - Has SJ but trip cancelled

## Users Needed
1. OWNER role account
2. ARMADA role account
3. OPERASIONAL role account

## Environment
- Staging or Test environment
- No production testing for destructive operations

---

# Regression Test Checklist

After fixing BUG-ORD-003, verify these still work:
- [ ] Order list loads without errors
- [ ] Order list pagination works
- [ ] Order list filters work
- [ ] Order list search works
- [ ] Order badges (hold, siap tagih) still display
- [ ] Click order row still opens detail
- [ ] Edit order button still works
- [ ] Delete order button still works
- [ ] Mobile responsive layout intact
```

## Test Case Patterns

### Pattern 1: CRUD Operations
```markdown
1. TC-XXX-001: Create [Entity] - Happy Path
2. TC-XXX-002: Create [Entity] - Validation Errors
3. TC-XXX-003: Read/View [Entity] Details
4. TC-XXX-004: Update [Entity] - Happy Path
5. TC-XXX-005: Update [Entity] - Validation
6. TC-XXX-006: Delete [Entity] - Confirmation
7. TC-XXX-007: Delete [Entity] - Cannot Delete (In Use)
```

### Pattern 2: List/Table Operations
```markdown
1. TC-XXX-010: List displays correctly
2. TC-XXX-011: Pagination works
3. TC-XXX-012: Search functionality
4. TC-XXX-013: Filter by status
5. TC-XXX-014: Sort by column
6. TC-XXX-015: Empty state display
7. TC-XXX-016: Mobile responsive list
```

### Pattern 3: Form Validation
```markdown
1. TC-XXX-020: Required fields validation
2. TC-XXX-021: Format validation (email, phone, etc)
3. TC-XXX-022: Length validation (min/max)
4. TC-XXX-023: Numeric validation
5. TC-XXX-024: Date validation
6. TC-XXX-025: Custom business rules
7. TC-XXX-026: Cross-field validation
```

### Pattern 4: Workflow Testing
```markdown
1. TC-XXX-030: Step 1 of workflow
2. TC-XXX-031: Step 2 of workflow
3. TC-XXX-032: Complete workflow happy path
4. TC-XXX-033: Cancel at each step
5. TC-XXX-034: Edit after submission
6. TC-XXX-035: Status transitions
7. TC-XXX-036: Audit trail verification
```

## Integration with Other Agents

### With Bug Analyzer
```
Generate test cases to verify fix for: BUG-XXX
```

### With Code Reviewer
```
Generate test cases for this new feature: [code or file]
```

## Quick Commands

### Generate Full Suite
```
Generate complete test suite for: [feature]
```

### Generate Specific Type
```
Generate edge cases for: [feature]
Generate regression tests for: [module]
Generate role-based tests for: [feature]
```

### Generate from User Story
```
Generate test cases from user story:
As a [role], I want to [action] so that [benefit]
```

### Generate Bug Verification Tests
```
Generate verification tests for: BUG-XXX-NNN
```

## Best Practices

### Test Case Quality
- ✅ Clear, specific steps (no ambiguity)
- ✅ One test case = one scenario
- ✅ Include actual test data values
- ✅ Expected results are measurable
- ✅ Prerequisites are clear
- ✅ Independent (can run in any order)

### Test Coverage
- ✅ Cover happy path first
- ✅ Then edge cases
- ✅ Then error scenarios
- ✅ Include role-based scenarios
- ✅ Mobile responsive tests
- ✅ Regression tests for fixes

### Test Data
- ✅ Use realistic data
- ✅ Avoid production data
- ✅ Document data requirements
- ✅ Include boundary values
- ✅ Test with special characters

## Success Criteria

Good test cases have:
- ✅ Clear test ID and title
- ✅ Specific steps with data
- ✅ Measurable expected results
- ✅ Prerequisites documented
- ✅ Test data specified
- ✅ Ready to execute immediately
- ✅ Can be understood by anyone

---

**Ready to generate test cases! Describe the feature or provide requirements.**