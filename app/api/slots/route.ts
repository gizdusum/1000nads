export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { CONTRACT_ADDRESS, WALL_ABI, TOTAL_SLOTS } from '@/lib/contracts'

const ZERO = '0x0000000000000000000000000000000000000000'

const monadChain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' as const } },
} as const

const client = createPublicClient({
  chain: monadChain,
  transport: http('https://testnet-rpc.monad.xyz'),
})

const OWNER_ABI = [{
  type: 'function', name: 'ownerOfSlot', stateMutability: 'view',
  inputs:  [{ name: 'slotId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

export type SlotData = {
  id: number; owner: string; imageUri: string
  note: string; isPermanent: boolean; mintedAt: number
} | null

// TTL for stale-while-revalidate
const TTL = 8_000

let cache: { slots: SlotData[]; ts: number } | null = null
let refreshing = false

// ── Concurrency limiter ────────────────────────────────────────────────────
async function runLimited<T>(tasks: (() => Promise<T>)[], max: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let idx = 0
  const worker = async () => {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, tasks.length) }, worker))
  return results
}

// ── Reliable single-slot owner fetch (low-level, avoids multicall) ─────────
// Monad testnet RPC rate-limits at ~5+ concurrent calls.
// We keep concurrency ≤ 3 and add backoff to guarantee resolution.
async function getOwnerChecked(slotId: number): Promise<string | null> {
  const addr = CONTRACT_ADDRESS as `0x${string}`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 300 * attempt))
      return await client.readContract({
        address: addr, abi: OWNER_ABI,
        functionName: 'ownerOfSlot', args: [BigInt(slotId)],
      }) as string
    } catch { /* retry */ }
  }
  return null
}

// ── Full slot data fetch ───────────────────────────────────────────────────
async function getSpotDataChecked(slotId: number): Promise<[string, string, string, boolean, bigint] | null> {
  const addr = CONTRACT_ADDRESS as `0x${string}`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 300 * attempt))
      return await client.readContract({
        address: addr, abi: WALL_ABI,
        functionName: 'spotData', args: [BigInt(slotId)],
      }) as [string, string, string, boolean, bigint]
    } catch { /* retry */ }
  }
  return null
}

// ── Main cache builder ─────────────────────────────────────────────────────
async function buildSlots(prev: SlotData[] | null): Promise<SlotData[]> {
  if (CONTRACT_ADDRESS === ZERO) return new Array(TOTAL_SLOTS).fill(null)

  const addr = CONTRACT_ADDRESS as `0x${string}`
  // undefined = RPC failed (not confirmed empty or minted)
  // ZERO string = confirmed empty
  // other address = confirmed minted
  const resolvedOwners: (string | undefined)[] = new Array(TOTAL_SLOTS).fill(undefined)

  // ── Pass 1: multicall in batches of 50, sequential pairs ──────────────
  // KEY: concurrency=2 prevents Monad RPC rate-limit (tested: 100+ concurrent fails)
  const BATCH = 50
  const batches = Array.from(
    { length: Math.ceil(TOTAL_SLOTS / BATCH) },
    (_, b) => ({ start: b * BATCH, size: Math.min(BATCH, TOTAL_SLOTS - b * BATCH) })
  )

  await runLimited(
    batches.map(({ start, size }) => async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt))
          const res = await client.multicall({
            contracts: Array.from({ length: size }, (_, i) => ({
              address: addr, abi: OWNER_ABI,
              functionName: 'ownerOfSlot' as const,
              args: [BigInt(start + i)] as const,
            })),
            allowFailure: true,
          })
          res.forEach((r, i) => {
            if (r.status === 'success') resolvedOwners[start + i] = r.result as string
          })
          return
        } catch { /* retry whole batch */ }
      }
    }),
    2  // ← max 2 concurrent multicall requests — avoids rate limit
  )

  // ── Pass 2: individual retry for unresolved — concurrency capped at 3 ──
  // Monad RPC fails at ~5+ concurrent; 3 is safe and resolves every slot.
  const unresolved = resolvedOwners.reduce<number[]>((acc, o, i) => {
    if (o === undefined) acc.push(i)
    return acc
  }, [])

  if (unresolved.length > 0) {
    console.log(`[slots] ${unresolved.length} unresolved after multicall, retrying individually`)
    await runLimited(
      unresolved.map(id => async () => {
        const owner = await getOwnerChecked(id)
        if (owner !== null) resolvedOwners[id] = owner
      }),
      3  // ← max 3 concurrent individual calls — Monad RPC safe limit
    )
  }

  // ── Pass 3: spotData for confirmed-minted slots — concurrency 3 ────────
  const mintedIds = resolvedOwners.reduce<number[]>((acc, o, i) => {
    if (o && o !== ZERO) acc.push(i)
    return acc
  }, [])
  console.log(`[slots] confirmed minted: [${mintedIds.join(', ')}]`)

  const slots: SlotData[] = new Array(TOTAL_SLOTS).fill(null)

  await runLimited(
    mintedIds.map(id => async () => {
      const data = await getSpotDataChecked(id)
      if (!data) {
        // spotData failed — preserve from prev cache to never lose a minted slot
        if (prev?.[id]) { slots[id] = prev[id]; return }
        return
      }
      const [owner, imageUri, note, isPermanent, mintedAt] = data
      if (owner !== ZERO) {
        slots[id] = { id, owner, imageUri, note, isPermanent, mintedAt: Number(mintedAt) * 1000 }
      }
    }),
    3
  )

  // ── Pass 4: preserve cache for still-unresolved slots ──────────────────
  // An unresolved slot (owner lookup failed even after retries) should not
  // overwrite a previously confirmed entry — RPC failure ≠ slot became empty.
  if (prev) {
    resolvedOwners.forEach((o, id) => {
      if (o === undefined && prev[id] && !slots[id]) {
        console.log(`[slots] preserving cached slot ${id} (owner lookup failed)`)
        slots[id] = prev[id]
      }
    })
  }

  return slots
}

// ── Cache management ───────────────────────────────────────────────────────
function currentSlots(): SlotData[] {
  return cache ? cache.slots : new Array(TOTAL_SLOTS).fill(null)
}

async function doRefresh() {
  if (refreshing) return
  refreshing = true
  try {
    const prev = cache?.slots ?? null
    const slots = await buildSlots(prev)
    cache = { slots, ts: Date.now() }
    console.log(`[slots] cache updated, minted count: ${slots.filter(Boolean).length}`)
  } catch (e) {
    console.error('[slots] refresh error:', e)
  } finally {
    refreshing = false
  }
}

export async function GET() {
  const age = cache ? Date.now() - cache.ts : Infinity

  // Fresh — return immediately
  if (age < TTL) {
    return NextResponse.json(cache!.slots, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Stale but exists — return stale immediately, refresh in background
  if (cache) {
    void doRefresh()
    return NextResponse.json(cache.slots, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Cold start — wait for first build
  await doRefresh()
  return NextResponse.json(currentSlots(), { headers: { 'Cache-Control': 'no-store' } })
}
