/**
 * Bank Account Creation API Test
 * Verifies that the normalizeBankAccountPayload await fix works correctly
 */

import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_ACCOUNT_NUMBER = `TEST${Date.now()}`;

const testCases = [
  {
    name: 'Valid Bank Account Creation',
    payload: {
      entity: 'bank-accounts',
      data: {
        bankName: 'BCA Test',
        accountNumber: TEST_ACCOUNT_NUMBER,
        accountHolder: 'PT Test Corporation',
        initialBalance: 1000000,
        notes: 'Test account for verification',
        active: true
      }
    },
    expectedStatus: 200,
    checkFields: ['bankName', 'accountNumber', 'accountHolder', 'initialBalance', 'active']
  },
  {
    name: 'Missing Bank Name (should fail)',
    payload: {
      entity: 'bank-accounts',
      data: {
        bankName: '',
        accountNumber: `TEST${Date.now()}`,
        accountHolder: 'PT Test',
        initialBalance: 500000
      }
    },
    expectedStatus: 400,
    shouldFail: true
  },
  {
    name: 'Missing Account Holder (should fail)',
    payload: {
      entity: 'bank-accounts',
      data: {
        bankName: 'BCA',
        accountNumber: `TEST${Date.now()}`,
        accountHolder: '',
        initialBalance: 500000
      }
    },
    expectedStatus: 400,
    shouldFail: true
  },
  {
    name: 'Negative Initial Balance (should fail)',
    payload: {
      entity: 'bank-accounts',
      data: {
        bankName: 'BCA',
        accountNumber: `TEST${Date.now()}`,
        accountHolder: 'PT Test',
        initialBalance: -1000
      }
    },
    expectedStatus: 400,
    shouldFail: true
  }
];

async function runTests() {
  console.log('\n📋 Bank Account Creation API Tests\n');
  console.log(`Testing API at: ${API_URL}\n`);
  
  let passedTests = 0;
  let failedTests = 0;

  for (const testCase of testCases) {
    console.log(`📝 Test: ${testCase.name}`);
    
    try {
      const response = await fetch(`${API_URL}/api/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testCase.payload)
      });

      const result = await response.json();
      const statusMatch = response.status === testCase.expectedStatus;

      if (statusMatch) {
        if (!testCase.shouldFail) {
          // Verify required fields are present
          const allFieldsPresent = testCase.checkFields.every(field => field in result);
          if (allFieldsPresent) {
            console.log(`✅ PASS - Status: ${response.status}, All required fields present`);
            console.log(`   Response: ${JSON.stringify({
              _id: result._id,
              bankName: result.bankName,
              accountNumber: result.accountNumber,
              accountHolder: result.accountHolder,
              initialBalance: result.initialBalance,
              currentBalance: result.currentBalance,
              active: result.active
            }, null, 2)}`);
            passedTests++;
          } else {
            const missingFields = testCase.checkFields.filter(f => !(f in result));
            console.log(`❌ FAIL - Missing fields: ${missingFields.join(', ')}`);
            console.log(`   Response: ${JSON.stringify(result, null, 2)}`);
            failedTests++;
          }
        } else {
          console.log(`✅ PASS - Status: ${response.status}, Validation error as expected`);
          console.log(`   Error: ${result.error}`);
          passedTests++;
        }
      } else {
        console.log(`❌ FAIL - Expected status ${testCase.expectedStatus}, got ${response.status}`);
        console.log(`   Response: ${JSON.stringify(result, null, 2)}`);
        failedTests++;
      }
    } catch (error) {
      console.log(`❌ ERROR - ${error.message}`);
      failedTests++;
    }
    console.log('');
  }

  console.log(`\n📊 Test Summary: ${passedTests} passed, ${failedTests} failed\n`);
  
  if (failedTests === 0) {
    console.log('🎉 All tests passed! Bank account creation is working correctly.');
    console.log('✅ Fix verified: normalizeBankAccountPayload with await is functioning properly.\n');
  } else {
    console.log('⚠️  Some tests failed. Please review the output above.\n');
  }
}

runTests().catch(console.error);
