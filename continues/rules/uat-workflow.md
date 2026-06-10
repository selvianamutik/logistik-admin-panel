# UAT Workflow Rules

## Overview
This document defines the standard workflow for conducting User Acceptance Testing (UAT) for PT Gading Mas Surya Admin Panel.

## Workflow Phases

```
1. PREPARATION
   ↓
2. EXECUTION
   ↓
3. BUG DISCOVERY
   ↓
4. DOCUMENTATION
   ↓
5. VERIFICATION
```

---

## Phase 1: Preparation

### Before Starting UAT Session

#### 1.1 Environment Setup
- [ ] Verify test environment URL is correct
- [ ] Confirm environment is stable (not deploying)
- [ ] Check test data is available
- [ ] Verify all test accounts accessible

#### 1.2 Browser Setup
- [ ] Open browser (Chrome recommended for DevTools)
- [ ] Clear cache and cookies
- [ ] Open DevTools (F12)
- [ ] Position Console and Network tabs for visibility
- [ ] Disable browser extensions that might interfere

#### 1.3 Documentation Prep
- [ ] Open Notion UAT database
- [ ] Have UAT checklist ready
- [ ] Prepare screenshot tool (Snipping Tool, CloudApp, etc)
- [ ] Start screen recording tool if needed (Loom, OBS)
- [ ] Have test data document accessible

#### 1.4 Test Account Verification
```markdown
Verify access to test accounts:
- [ ] OWNER: owner@company.local
- [ ] ADMIN/OPERASIONAL: ops@company.local
- [ ] FINANCE: finance@company.local
- [ ] ARMADA: armada@company.local

Note: Never test with production accounts!
```

---

## Phase 2: Execution

### During Testing

#### 2.1 Start Testing Session
1. Login with appropriate role
2. Start screen recording (optional but recommended)
3. Open DevTools Console tab
4. Begin following test cases

#### 2.2 Execute Test Steps

**For Each Test Case:**

```markdown
1. READ test case completely before starting
2. VERIFY prerequisites are met
3. PREPARE test data needed
4. EXECUTE steps one by one
5. OBSERVE actual behavior
6. COMPARE with expected result
7. DOCUMENT outcome (Pass/Fail)
```

#### 2.3 Observation Checklist

While executing each step, observe:

**Visual Layer:**
- [ ] Page loads without visual glitches
- [ ] Layout is responsive and proper
- [ ] Buttons and links are clearly visible
- [ ] Loading states display correctly
- [ ] Success/error messages appear
- [ ] Data displays correctly formatted

**Functional Layer:**
- [ ] Actions complete as expected
- [ ] Data saves correctly
- [ ] Navigation works properly
- [ ] Forms validate appropriately
- [ ] Calculations are accurate
- [ ] Status updates correctly

**Technical Layer (DevTools):**
- [ ] No console errors (red text)
- [ ] No failed network requests
- [ ] No warnings about deprecated code
- [ ] Response times reasonable
- [ ] No memory leaks (for long sessions)

#### 2.4 Real-time Documentation

**Update Notion immediately:**
- Mark test status (Pass/Fail/Blocked)
- Note actual result if different from expected
- Add quick observations
- Take screenshots of key steps

**Don't wait until end of session!**

---

## Phase 3: Bug Discovery

### When You Find a Bug

#### 3.1 Immediate Actions

**STOP and document immediately:**

1. **Capture Evidence**
   - [ ] Screenshot the bug state
   - [ ] Screenshot console errors (if any)
   - [ ] Screenshot network tab (if API error)
   - [ ] Note exact URL
   - [ ] Note timestamp

2. **Quick Bug Note**
   ```markdown
   BUG FOUND:
   - Where: [URL/page]
   - What: [What's wrong]
   - Expected: [What should happen]
   - Actual: [What happened]
   - Console errors: [Yes/No - screenshot]
   ```

3. **Try to Reproduce**
   - [ ] Can you reproduce it?
   - [ ] Happens every time or intermittent?
   - [ ] Happens on different browser?
   - [ ] Happens for different role?

#### 3.2 Bug Severity Assessment

**Ask yourself:**

🔴 **Is it CRITICAL?**
- Causes data loss or corruption?
- System crashes or becomes unavailable?
- Security vulnerability exposed?
- Financial calculation wrong?
- **→ Stop UAT, report immediately!**

🟠 **Is it HIGH priority?**
- Major feature completely broken?
- Affects core workflow?
- No workaround available?
- **→ Document fully, continue with other tests**

🟡 **Is it MEDIUM priority?**
- Feature partially works?
- Workaround exists?
- Only some users affected?
- **→ Document, continue testing**

🟢 **Is it LOW priority?**
- Visual/cosmetic issue?
- Rare edge case?
- Minor inconvenience?
- **→ Quick note, continue testing**

#### 3.3 Detailed Bug Documentation

**Create Full Bug Report in Notion:**

Use Bug Documentation template:
1. Generate Bug ID
2. Write clear summary
3. List reproduction steps
4. Document expected vs actual
5. Attach all evidence
6. Note environment details
7. Assess severity and impact
8. Link to test case

**See: `bug-documentation.md` for full template**

#### 3.4 Communication

**When to notify team:**

- 🔴 **Critical bugs**: Notify immediately (Slack/WhatsApp)
- 🟠 **High bugs**: Include in daily summary
- 🟡 **Medium bugs**: Include in weekly report
- 🟢 **Low bugs**: Include in final UAT report

**Message Template:**
```
🚨 [CRITICAL/HIGH] Bug Found in UAT

Bug ID: BUG-XXX-NNN
Module: [Module name]
Issue: [One line summary]

Impact: [Who/what is affected]
Status: Documented in Notion
Link: [Notion bug report link]

Blocks: [Test cases blocked, if any]
```

---

## Phase 4: Documentation

### End of Testing Session

#### 4.1 Update Test Status

For each test case:
- [ ] Mark final status (Pass/Fail/Blocked/Skipped)
- [ ] Link bugs found (if failed)
- [ ] Add any additional notes
- [ ] Attach all screenshots/videos
- [ ] Note time spent

#### 4.2 Session Summary

**Create summary in Notion:**

```markdown
# UAT Session Summary - [Date]

## Overview
- Tester: [Your name]
- Date: [YYYY-MM-DD]
- Duration: [X hours]
- Environment: [Staging/Production]
- Modules tested: [List]

## Test Results
- Total test cases: X
- Passed: X (XX%)
- Failed: X (XX%)
- Blocked: X
- Skipped: X

## Bugs Found
- Critical: X
- High: X
- Medium: X
- Low: X

## Top Issues
1. [Bug ID + summary]
2. [Bug ID + summary]
3. [Bug ID + summary]

## Blockers
[Any issues preventing further testing]

## Next Steps
[What needs to be tested next]

## Notes
[Any observations or recommendations]
```

#### 4.3 Evidence Organization

**File naming convention:**
```
[Date]_[BugID]_[Description].[ext]

Examples:
20240120_BUG-ORD-003_SJ-Not-Clickable.png
20240120_TC-ORD-101_Happy-Path.mp4
```

**Storage:**
- Screenshots: Upload to Notion bug report
- Videos: Upload to Loom/CloudApp, link in Notion
- Logs: Copy to text file, attach to Notion

---

## Phase 5: Verification

### After Bug Fixes

#### 5.1 Re-test Preparation

**Before re-testing:**
- [ ] Confirm fix deployed to test environment
- [ ] Review bug report to understand fix
- [ ] Prepare original test case
- [ ] Prepare regression test cases

#### 5.2 Verification Testing

**Test the fix:**

1. **Reproduce Original Bug**
   - Follow original steps to reproduce
   - Verify bug no longer occurs
   - Document that fix works

2. **Test Edge Cases**
   - Test variations of original scenario
   - Test boundary conditions
   - Test with different data

3. **Regression Testing**
   - Test related features
   - Verify fix didn't break anything else
   - Check similar patterns in other modules

#### 5.3 Verification Outcomes

**✅ Fix Verified:**
```markdown
Bug Status: ✅ Verified Fixed

Verification Date: [Date]
Verified By: [Your name]
Test Results:
- Original scenario: PASS
- Edge cases: PASS
- Regression tests: PASS

Notes: [Any observations]
```

**❌ Fix Not Working:**
```markdown
Bug Status: ❌ Re-opened

Verification Date: [Date]
Verified By: [Your name]
Test Results:
- Original scenario: FAIL
- Issue: [What's still wrong]

Evidence: [New screenshots/logs]
Next Steps: [Notify dev team]
```

**⚠️ Partial Fix:**
```markdown
Bug Status: ⚠️ Partially Fixed

Verification Date: [Date]
Verified By: [Your name]
Test Results:
- Original scenario: PASS
- But new issue found: [Description]

Action: Created new bug report [BUG-XXX-NNN]
```

---

## Best Practices

### Do's ✅

1. **Test Systematically**
   - Follow test cases in order
   - Complete one module before moving to next
   - Don't skip steps

2. **Document Everything**
   - Screenshot key steps
   - Note timestamps
   - Capture errors immediately
   - Update Notion in real-time

3. **Think Like a User**
   - Try realistic scenarios
   - Use real data patterns
   - Test common workflows
   - Consider user mistakes

4. **Be Thorough**
   - Test edge cases
   - Try different roles
   - Test mobile responsive
   - Check different browsers

5. **Communicate Clearly**
   - Use clear language
   - Provide specific examples
   - Include reproduction steps
   - Share evidence

### Don'ts ❌

1. **Don't Rush**
   - Don't skip documentation
   - Don't assume "it probably works"
   - Don't test multiple things at once
   - Don't forget to logout between roles

2. **Don't Test in Production**
   - Never use production accounts
   - Never test destructive actions in prod
   - Never test with real customer data
   - Always use test/staging environment

3. **Don't Ignore Small Issues**
   - Small bugs can indicate bigger problems
   - Document everything
   - Even "minor" issues matter
   - Patterns of small bugs = quality concern

4. **Don't Work Alone**
   - Share findings with team
   - Ask questions when unclear
   - Collaborate on complex issues
   - Report blockers immediately

5. **Don't Make Assumptions**
   - Verify behavior, don't guess
   - Test even "obvious" things
   - Confirm fixes actually work
   - Question unexpected behavior

---

## Efficiency Tips

### Time Management

**Prioritize:**
1. Critical features first
2. Core workflows next
3. Edge cases after
4. Nice-to-have features last

**Time blocks:**
- 25 min testing
- 5 min documentation
- Repeat

**Avoid fatigue:**
- Take breaks every hour
- Switch modules to stay fresh
- Don't test for more than 3 hours straight

### Tool Shortcuts

**Browser:**
- F12: Open DevTools
- Ctrl+Shift+C: Inspect element
- Ctrl+Shift+Delete: Clear cache
- F5: Refresh page
- Ctrl+Shift+R: Hard refresh

**Screenshots:**
- Win+Shift+S: Windows snipping tool
- Cmd+Shift+4: Mac screenshot
- Print Screen: Full screen capture

**Documentation:**
- Create Notion templates for common cases
- Use text expander for repeated text
- Keep test data in easily accessible file

---

## Checklist: Daily UAT Session

### Before Starting
- [ ] Environment ready
- [ ] Browser setup with DevTools
- [ ] Test accounts verified
- [ ] Notion templates ready
- [ ] Screen recording tool ready

### During Testing
- [ ] Following test cases systematically
- [ ] Documenting in real-time
- [ ] Capturing evidence immediately
- [ ] Checking console for errors
- [ ] Testing with different roles

### After Session
- [ ] All test cases status updated
- [ ] All bugs documented
- [ ] Evidence uploaded
- [ ] Session summary created
- [ ] Team notified of critical issues

### End of Week
- [ ] Weekly summary report
- [ ] Bug statistics compiled
- [ ] Regression test suite updated
- [ ] Lessons learned documented

---

## Quality Gates

### Before Marking Test as PASS
- [ ] Expected result achieved
- [ ] No console errors
- [ ] No visual glitches
- [ ] Data saved correctly
- [ ] Tested edge cases
- [ ] Works on mobile (if applicable)

### Before Marking Module as Complete
- [ ] All test cases executed
- [ ] All bugs documented
- [ ] Regression tests passed
- [ ] Role-based tests passed
- [ ] Mobile tests passed
- [ ] No blocking issues remain

### Before Recommending Release
- [ ] No critical bugs open
- [ ] High priority bugs acceptable or fixed
- [ ] Core workflows verified
- [ ] Performance acceptable
- [ ] Security checks passed
- [ ] Audit trail verified

---

## Escalation Path

### When to Escalate

**Immediate escalation (within 1 hour):**
- Critical bug found
- Security vulnerability discovered
- Data corruption detected
- System completely unavailable

**Same-day escalation:**
- High priority bug blocking testing
- Multiple related bugs indicate system issue
- Test environment unstable
- Access issues preventing testing

**Next-day escalation:**
- Medium priority bugs accumulating
- Clarification needed on requirements
- Test data issues
- Schedule concerns

### Escalation Process

1. **Document First**
   - Create bug report or issue document
   - Gather all evidence
   - Prepare clear summary

2. **Notify Appropriate Channel**
   - Critical: Direct message + team channel
   - High: Team channel
   - Medium: Daily standup or Slack

3. **Follow Up**
   - Track response
   - Provide additional info if requested
   - Update status when resolved

---

## Success Criteria

### Effective UAT Session
- ✅ All planned tests executed or documented why not
- ✅ All bugs found are documented thoroughly
- ✅ Evidence is complete and organized
- ✅ Team is informed of critical issues
- ✅ Next steps are clear

### Quality Bug Report
- ✅ Clear reproduction steps
- ✅ Complete evidence attached
- ✅ Impact clearly described
- ✅ Appropriate severity assigned
- ✅ Linked to test case

### Professional UAT
- ✅ Systematic approach
- ✅ Thorough documentation
- ✅ Clear communication
- ✅ Objective assessment
- ✅ Constructive feedback

---

**Follow this workflow consistently for high-quality UAT results!**