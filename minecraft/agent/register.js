/**
 * OpenWorld Agent — Registration
 * Solves the anti-human challenge and registers the agent.
 * Can be run standalone: node register.js
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');

const BASE_URL = process.env.OPENWORLD_URL;
const AGENT_NAME = process.env.AGENT_NAME;

if (!BASE_URL || !AGENT_NAME) {
  console.error('[REGISTER] Missing OPENWORLD_URL or AGENT_NAME in .env');
  process.exit(1);
}

/**
 * Solve a registration challenge.
 * Challenge types from the server:
 *  1. "Compute X * Y + 7"
 *  2. "Reverse this array and join with '-': [...]"
 *  3. 'What is the value of "key" in {...}?'
 *  4. 'How many characters in "..."?'
 */
function solveChallenge(question) {
  // Type 1: Compute X * Y + 7
  const computeMatch = question.match(/Compute\s+(\d+)\s*\*\s*(\d+)\s*\+\s*(\d+)/);
  if (computeMatch) {
    const [, a, b, c] = computeMatch.map(Number);
    return String(a * b + c);
  }

  // Type 2: Reverse array and join
  const reverseMatch = question.match(/Reverse this array and join with '-':\s*(\[.*?\])/);
  if (reverseMatch) {
    const arr = JSON.parse(reverseMatch[1]);
    return arr.reverse().join('-');
  }

  // Type 3: Extract value from JSON object
  const valueMatch = question.match(/What is the value of "(\w+)" in ({.*?})\?/);
  if (valueMatch) {
    const key = valueMatch[1];
    const obj = JSON.parse(valueMatch[2]);
    return String(obj[key]);
  }

  // Type 4: String length
  const lengthMatch = question.match(/How many characters in "(.+?)"\?/);
  if (lengthMatch) {
    return String(lengthMatch[1].length);
  }

  throw new Error(`Unknown challenge type: ${question}`);
}

/**
 * Register the agent with the OpenWorld server.
 * Returns the token.
 */
export async function register() {
  console.log(`[REGISTER] Getting challenge from ${BASE_URL}...`);

  // Step 1: Get challenge
  const challengeRes = await fetch(`${BASE_URL}/api/register/challenge`);
  if (!challengeRes.ok) {
    throw new Error(`Challenge request failed: ${challengeRes.status} ${await challengeRes.text()}`);
  }
  const challengeData = await challengeRes.json();
  console.log(`[REGISTER] Challenge: ${challengeData.challenge}`);

  // Step 2: Solve it
  const answer = solveChallenge(challengeData.challenge);
  console.log(`[REGISTER] Answer: ${answer}`);

  // Step 3: Register
  const registerRes = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: AGENT_NAME,
      challenge_id: challengeData.challenge_id,
      answer,
    }),
  });

  if (!registerRes.ok) {
    const err = await registerRes.json().catch(() => ({}));
    throw new Error(`Registration failed: ${err.error || registerRes.status}`);
  }

  const result = await registerRes.json();
  console.log(`[REGISTER] Registered as "${result.name}" (id: ${result.id})`);
  console.log(`[REGISTER] Token: ${result.token}`);

  // Step 4: Save token to .env
  try {
    let envContent = readFileSync(ENV_PATH, 'utf-8');
    envContent = envContent.replace(/^AGENT_TOKEN=.*$/m, `AGENT_TOKEN=${result.token}`);
    writeFileSync(ENV_PATH, envContent);
    console.log('[REGISTER] Token saved to .env');
  } catch {
    console.log(`[REGISTER] Could not auto-save token. Add this to your .env:`);
    console.log(`AGENT_TOKEN=${result.token}`);
  }

  return result.token;
}

// Run standalone
if (process.argv[1] && process.argv[1].endsWith('register.js')) {
  register().catch((err) => {
    console.error('[REGISTER] Failed:', err.message);
    process.exit(1);
  });
}
