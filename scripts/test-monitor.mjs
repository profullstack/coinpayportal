#!/usr/bin/env node

/**
 * Test script for the payment monitor
 *
 * Usage:
 *   node scripts/test-monitor.mjs [command] [APP_URL] [API_KEY]
 *
 * Commands:
 *   status    - Check monitor status
 *   start     - Start the monitor
 *   stop      - Stop the monitor
 *   run-once  - Run a single monitor cycle
 *   cron      - Call the cron endpoint (legacy)
 *
 * Or set environment variables:
 *   - INTERNAL_API_KEY
 *   - NEXT_PUBLIC_APP_URL or APP_URL
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Try to load .env file manually
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // .env file not found, continue with existing env vars
  }
}

loadEnv();

const command = process.argv[2] || 'status';
const APP_URL = process.argv[3] || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
const API_KEY = process.argv[4] || process.env.INTERNAL_API_KEY;

async function checkStatus() {
  console.log('Checking monitor status...');
  console.log(`URL: ${APP_URL}/api/monitor/status`);
  
  try {
    const response = await fetch(`${APP_URL}/api/monitor/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    console.log('\nResponse status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log(`\n✅ Monitor is ${data.isRunning ? 'RUNNING' : 'STOPPED'}`);
    } else {
      console.log('\n❌ Failed to get status:', data.error);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

async function controlMonitor(action) {
  console.log(`${action === 'run-once' ? 'Running single cycle' : action === 'start' ? 'Starting' : 'Stopping'} monitor...`);
  console.log(`URL: ${APP_URL}/api/monitor/status`);
  
  try {
    const response = await fetch(`${APP_URL}/api/monitor/status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    });
    
    const data = await response.json();
    
    console.log('\nResponse status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log(`\n✅ ${data.message}`);
      if (data.stats) {
        console.log(`   Checked: ${data.stats.checked} payments`);
        console.log(`   Confirmed: ${data.stats.confirmed} payments`);
        console.log(`   Expired: ${data.stats.expired} payments`);
        console.log(`   Errors: ${data.stats.errors}`);
      }
      console.log(`   Monitor is now ${data.isRunning ? 'RUNNING' : 'STOPPED'}`);
    } else {
      console.log('\n❌ Failed:', data.error);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

async function testCronEndpoint() {
  console.log('Testing cron endpoint...');
  console.log(`URL: ${APP_URL}/api/cron/monitor-payments`);
  
  try {
    const response = await fetch(`${APP_URL}/api/cron/monitor-payments`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    console.log('\nResponse status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log('\n✅ Cron executed successfully!');
      console.log(`   Checked: ${data.stats.checked} payments`);
      console.log(`   Confirmed: ${data.stats.confirmed} payments`);
      console.log(`   Expired: ${data.stats.expired} payments`);
      console.log(`   Errors: ${data.stats.errors}`);
    } else {
      console.log('\n❌ Cron failed:', data.error);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

// Main
console.log('='.repeat(50));
console.log('Payment Monitor Test Script');
console.log('='.repeat(50));
console.log(`Command: ${command}`);
console.log(`App URL: ${APP_URL}`);
console.log(`API Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : 'NOT SET'}`);
console.log('='.repeat(50));

switch (command) {
  case 'status':
    checkStatus();
    break;
  case 'start':
    controlMonitor('start');
    break;
  case 'stop':
    controlMonitor('stop');
    break;
  case 'run-once':
    controlMonitor('run-once');
    break;
  case 'cron':
    testCronEndpoint();
    break;
  default:
    console.log('Unknown command. Use: status, start, stop, run-once, or cron');
}