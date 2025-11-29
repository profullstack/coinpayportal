#!/usr/bin/env node

/**
 * Test script for the payment monitor cron endpoint
 *
 * Usage:
 *   node scripts/test-monitor.mjs [APP_URL] [CRON_SECRET]
 *
 * Or set environment variables:
 *   - INTERNAL_API_KEY or CRON_SECRET
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

const APP_URL = process.argv[2] || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
const CRON_SECRET = process.argv[3] || process.env.CRON_SECRET || process.env.INTERNAL_API_KEY;

async function testMonitor() {
  console.log('Testing payment monitor endpoint...');
  console.log(`URL: ${APP_URL}/api/cron/monitor-payments`);
  
  try {
    const response = await fetch(`${APP_URL}/api/cron/monitor-payments`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    
    console.log('\nResponse status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log('\n✅ Monitor executed successfully!');
      console.log(`   Checked: ${data.stats.checked} payments`);
      console.log(`   Confirmed: ${data.stats.confirmed} payments`);
      console.log(`   Expired: ${data.stats.expired} payments`);
      console.log(`   Errors: ${data.stats.errors}`);
    } else {
      console.log('\n❌ Monitor failed:', data.error);
    }
  } catch (error) {
    console.error('\n❌ Error calling monitor endpoint:', error.message);
  }
}

testMonitor();