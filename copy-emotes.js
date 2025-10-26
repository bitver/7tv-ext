import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const API_URL = "https://api.7tv.app/v4/gql";
const TOKEN = process.env.SEVENTV_TOKEN;
const SOURCE_SET_ID = process.env.SOURCE_SET_ID;
const TARGET_SET_ID = process.env.TARGET_SET_ID;

// Rate limiter configuration
const RATE_LIMIT = {
  requests: 10, // requests per window
  windowMs: 60000, // 1 minute window
  mutationDelay: 1000, // 1 second delay between mutations
};

class RateLimiter {
  constructor(requests, windowMs) {
    this.requests = requests;
    this.windowMs = windowMs;
    this.requestTimes = [];
  }

  async wait() {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requestTimes = this.requestTimes.filter(time => now - time < this.windowMs);
    
    // If we've hit the limit, wait until the oldest request expires
    if (this.requestTimes.length >= this.requests) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      if (waitTime > 0) {
        console.log(`Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.wait(); // Recursively check again
      }
    }
    
    // Add current request timestamp
    this.requestTimes.push(now);
  }
}

const rateLimiter = new RateLimiter(RATE_LIMIT.requests, RATE_LIMIT.windowMs);

async function gql(query, variables = {}, isMutation = false) {
  // Apply rate limiting
  await rateLimiter.wait();
  
  // Extra delay for mutations to be conservative
  if (isMutation) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.mutationDelay));
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error("GraphQL errors: " + JSON.stringify(json.errors));
  }
  return json.data;
}

// --- Fetch emote set ---
async function fetchEmoteSet(setId) {
  const query = `
    query GetEmoteSet($id: String!) {
      emoteSets {
        emoteSet(id: $id) {
          id
          name
          emotes {
            items {
              id
              alias
              emote {
                id
                defaultName
              }
            }
          }
        }
      }
    }
  `;
  const data = await gql(query, { id: setId });
  if (!data.emoteSets?.emoteSet) throw new Error("Set not found: " + setId);
  return data.emoteSets.emoteSet;
}

// --- Add emote to set ---
async function addEmoteToSet(setId, emoteId, alias) {
  const mutation = `
    mutation AddEmote($setId: String!, $emoteId: String!, $alias: String) {
      emoteSets {
        emoteSet(id: $setId) {
          addEmote(id: { emoteId: $emoteId, alias: $alias }) {
            id
            name
          }
        }
      }
    }
  `;
  return gql(mutation, { setId, emoteId, alias }, true); // Mark as mutation
}

// --- Main ---
(async () => {
  try {
    console.log("Fetching source set...");
    const source = await fetchEmoteSet(SOURCE_SET_ID);
    console.log(`Source: ${source.name} (${source.emotes.items.length} emotes)`);

    console.log("Fetching target set...");
    const target = await fetchEmoteSet(TARGET_SET_ID);
    const targetNames = new Set(target.emotes.items.map(e => e.alias));
    console.log(`Target: ${target.name} (${target.emotes.items.length} emotes)`);

    let processed = 0;
    let added = 0;
    let skipped = 0;
    let failed = 0;
    const total = source.emotes.items.length;

    console.log(`\nStarting copy process: ${total} emotes to process\n`);

    for (const emoteItem of source.emotes.items) {
      processed++;
      
      if (targetNames.has(emoteItem.alias)) {
        skipped++;
        console.log(`[${processed}/${total}] Skipping duplicate: ${emoteItem.alias}`);
        continue;
      }

      try {
        console.log(`[${processed}/${total}] Adding: ${emoteItem.alias}`);
        await addEmoteToSet(TARGET_SET_ID, emoteItem.emote.id, emoteItem.alias);
        targetNames.add(emoteItem.alias);
        added++;
        console.log(`[${processed}/${total}] ✓ Successfully added: ${emoteItem.alias}`);
      } catch (err) {
        failed++;
        console.warn(`[${processed}/${total}] ✗ Failed to add ${emoteItem.alias}: ${err.message}`);
        
        // If rate limited, add extra delay and continue
        if (err.message.includes("rate") || err.message.includes("limit") || err.message.includes("429")) {
          console.log("Detected rate limiting, adding extra delay...");
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second pause
        }
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  Total processed: ${processed}`);
    console.log(`  Successfully added: ${added}`);
    console.log(`  Skipped (duplicates): ${skipped}`);
    console.log(`  Failed: ${failed}`);

    console.log("✅ Done!");
  } catch (err) {
    console.error("Failed:", err.message);
  }
})();
