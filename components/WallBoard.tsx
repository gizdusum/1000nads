'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  useAccount, useBalance, useChainId, useReadContract, useReadContracts,
  useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from 'wagmi'
import { formatEther } from 'viem'
import {
  CONTRACT_ADDRESS, getMegaBlock, getMintPrice, GRID_COLUMNS, GRID_ROWS,
  isHiddenSlot, MEGA_PRICE_4W, MEGA_PRICE_6W, SLOT_PRICE_WEI,
  TOTAL_SLOTS, WALL_ABI,
} from '@/lib/contracts'
import { siteCopy } from '@/lib/content'
import { createMockSlots, type Slot } from '@/lib/mock-slots'
import { KeoneSprint } from '@/components/KeoneSprint'
import { AmbientAudio } from '@/components/AmbientAudio'
import Image from 'next/image'

const ZERO     = '0x0000000000000000000000000000000000000000'
const MONAD_ID = 10143
const UPLOAD_PX = 160
const CACHE_KEY = '1000nads_slots_v2'

type Phase = 'gate' | 'wall' | 'form' | 'done'

// ── localStorage helpers ─────────────────────────────────────────────────────

function loadSlotCache(empty: Slot[]): Slot[] {
  if (typeof window === 'undefined') return empty
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Slot[]
    if (!Array.isArray(parsed) || parsed.length !== TOTAL_SLOTS) return empty
    return parsed
  } catch {
    return empty
  }
}

function saveSlotCache(slots: Slot[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(slots)) } catch {}
}

// ── Note encode/decode (stores twitter as "@handle|note") ────────────────────

function encodeNote(twitter: string, note: string): string {
  const t = twitter.trim()
  const n = note.trim()
  if (t && n) return `@${t}|${n}`
  if (t)      return `@${t}`
  return n
}

function parseNote(raw: string): { twitter: string; note: string } {
  if (raw.startsWith('@')) {
    const pipe = raw.indexOf('|')
    if (pipe !== -1) return { twitter: raw.slice(1, pipe), note: raw.slice(pipe + 1) }
    return { twitter: raw.slice(1), note: '' }
  }
  return { twitter: '', note: raw }
}

// ── Image resize ─────────────────────────────────────────────────────────────

async function resizeImage(src: string) {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new window.Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('Load failed'))
    i.src = src
  })
  const c = document.createElement('canvas')
  c.width = UPLOAD_PX; c.height = UPLOAD_PX
  const ctx = c.getContext('2d')!
  const s = Math.max(UPLOAD_PX / img.width, UPLOAD_PX / img.height)
  const w = img.width * s; const h = img.height * s
  ctx.fillStyle = '#140026'
  ctx.fillRect(0, 0, UPLOAD_PX, UPLOAD_PX)
  ctx.drawImage(img, (UPLOAD_PX - w) / 2, (UPLOAD_PX - h) / 2, w, h)
  const webp = c.toDataURL('image/webp', 0.88)
  return webp.length <= 180000 ? webp : c.toDataURL('image/jpeg', 0.86)
}

// ── TPS counter hook ─────────────────────────────────────────────────────────

function useTpsCounter(active: boolean) {
  const [tps, setTps] = useState(0)
  useEffect(() => {
    if (!active) { setTps(0); return }
    let v = 0
    const iv = setInterval(() => {
      v = Math.min(v + Math.floor(Math.random() * 900 + 400), 9800)
      setTps(v)
      if (v >= 9800) clearInterval(iv)
    }, 60)
    return () => clearInterval(iv)
  }, [active])
  return tps
}

// ── useSlots hook (localStorage cache, no setState in useMemo) ───────────────

function useSlots() {
  const contracts = useMemo(() =>
    CONTRACT_ADDRESS === ZERO ? [] :
    Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
      address: CONTRACT_ADDRESS, abi: WALL_ABI,
      functionName: 'spotData' as const, args: [BigInt(i)] as const,
    })), [])

  const { data, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, refetchInterval: 7000 },
  })

  const empty = useMemo(() => createMockSlots(TOTAL_SLOTS), [])
  const [cached, setCached] = useState<Slot[]>(() => loadSlotCache(empty))

  const freshSlots = useMemo(() => {
    if (!data || !contracts.length) return null
    return empty.map((fb, i) => {
      const item = data[i]
      if (!item || item.status !== 'success') return fb
      const [owner, imageUri, note, isPermanent, mintedAt] =
        item.result as [string, string, string, boolean, bigint]
      if (owner === ZERO) return fb
      return { id: i, imageUri, owner, note, isPermanent, mintedAt: Number(mintedAt) * 1000 }
    })
  }, [contracts.length, data, empty])

  useEffect(() => {
    if (!freshSlots) return
    saveSlotCache(freshSlots)
    setCached(freshSlots)
  }, [freshSlots])

  return { slots: freshSlots ?? cached, refetch }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function short(a: string | null) {
  if (!a) return 'available'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function priceLabel(slotId: number) {
  const p = getMintPrice(slotId)
  if (p === MEGA_PRICE_6W) return '60 MON · 6-wide premium'
  if (p === MEGA_PRICE_4W) return '40 MON · 4-wide premium'
  return '1 MON'
}

// ── WallBoard ────────────────────────────────────────────────────────────────

export function WallBoard() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const { slots, refetch } = useSlots()

  const { data: balance } = useBalance({
    address, chainId: MONAD_ID,
    query: { enabled: !!address },
  })

  const { data: ownedMarker } = useReadContract({
    address: CONTRACT_ADDRESS, abi: WALL_ABI, functionName: 'walletToSlot',
    args: address ? [address] : undefined,
    query: { enabled: !!address && CONTRACT_ADDRESS !== ZERO, refetchInterval: 7000 },
  })

  const [phase, setPhase]         = useState<Phase>('gate')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [inspectId, setInspectId]   = useState<number | null>(null)
  const [note, setNote]             = useState('')
  const [twitter, setTwitter]       = useState('')
  const [twitterWarn, setTwitterWarn] = useState(false)
  const [previewUri, setPreviewUri] = useState('')
  const [imageUri, setImageUri]     = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [preparing, setPreparing]   = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const tpsCounter = useTpsCounter(isPending || confirming)

  useEffect(() => {
    if (!isSuccess) return
    setPhase('done'); setError(null); void refetch()
  }, [isSuccess, refetch])

  const minted    = slots.filter(s => !!s.owner).length
  const remaining = TOTAL_SLOTS - minted
  const onChain   = chainId === MONAD_ID
  const alreadyOwns = typeof ownedMarker === 'bigint' && ownedMarker > 0n
  const selected    = selectedId !== null ? slots[selectedId] : null
  const inspected   = inspectId  !== null ? slots[inspectId]  : null
  const mintPrice   = selectedId !== null ? getMintPrice(selectedId) : SLOT_PRICE_WEI
  const hasFunds    = !!balance && balance.value >= mintPrice

  const openForm = useCallback((id: number) => {
    setSelectedId(id); setNote(''); setTwitter(''); setTwitterWarn(false)
    setPreviewUri(''); setImageUri(''); setError(null); setPhase('form')
  }, [])

  const handleTwitterChange = (val: string) => {
    const isUrl = /https?:\/\/|x\.com|twitter\.com/.test(val)
    setTwitterWarn(isUrl)
    const clean = val.replace(/[@/\s]/g, '').slice(0, 30)
    setTwitter(clean)
  }

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setError(null); setPreparing(true)
    try {
      if (file.size > 3_000_000) throw new Error('Image must be under 3 MB.')
      const raw = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => typeof r.result === 'string' ? res(r.result) : rej(new Error('Read error'))
        r.onerror = () => rej(new Error('Read error'))
        r.readAsDataURL(file)
      })
      const out = await resizeImage(raw)
      if (out.length > 180000) throw new Error('Image too large after compression.')
      setPreviewUri(out); setImageUri(out)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image error.')
    } finally {
      setPreparing(false)
    }
  }

  const handleMint = async () => {
    setError(null)
    if (!selected || selected.owner) return
    if (!isConnected) return setError('Connect your wallet first.')
    if (!onChain) {
      try { await switchChainAsync({ chainId: MONAD_ID }) }
      catch (err) { setError(err instanceof Error ? err.message : 'Network switch failed.') }
      return
    }
    if (alreadyOwns) return setError('This wallet already owns a square.')
    if (!hasFunds) return setError(`You need at least ${formatEther(mintPrice)} MON on Monad testnet.`)
    if (!imageUri)  return setError('Upload an image first.')
    const combinedNote = encodeNote(twitter, note)
    if (combinedNote.length > 96) return setError('Note too long (max 96 chars).')
    try {
      await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: WALL_ABI, functionName: 'mintSpot',
        args: [BigInt(selected.id), imageUri, combinedNote, true],
        value: mintPrice,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mint failed.')
    }
  }

  const mintLabel = (() => {
    if (!isConnected) return 'Connect wallet first'
    if (!onChain)     return switching ? 'Switching...' : 'Switch to Monad Testnet'
    if (alreadyOwns)  return 'Wallet already owns a square'
    if (!hasFunds)    return `Need ${formatEther(mintPrice)} MON — get from faucet`
    if (preparing)    return 'Preparing image...'
    if (!imageUri)    return 'Upload an image to continue'
    if (isPending || confirming) return `Confirming on Monad… ${tpsCounter.toLocaleString()} TPS`
    return '✦ Write my name to history'
  })()

  const canMint = isConnected && onChain && !alreadyOwns && hasFunds && !!imageUri &&
    !isPending && !confirming && !preparing && !selected?.owner

  // ── Grid ──────────────────────────────────────────────────────────────────

  const GridSlots = ({ dim = false }: { dim?: boolean }) => (
    <div
      className="wall-grid"
      style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}
    >
      {slots.map(slot => {
        if (isHiddenSlot(slot.id)) return null

        const mega      = getMegaBlock(slot.id)
        const colSpan   = mega?.colSpan ?? 1
        const isSelected = slot.id === selectedId
        const isMega    = colSpan > 1

        return (
          <button
            key={slot.id}
            type="button"
            className={[
              'wall-slot',
              slot.owner ? 'wall-slot--owned' : 'wall-slot--open',
              isSelected ? 'wall-slot--active' : '',
              isMega     ? `wall-slot--mega wall-slot--mega-${colSpan}` : '',
            ].filter(Boolean).join(' ')}
            style={colSpan > 1 ? { gridColumn: `span ${colSpan}` } : undefined}
            onClick={() => {
              if (dim) return
              if (slot.owner) setInspectId(slot.id)
              else openForm(slot.id)
            }}
            title={slot.owner ? `Owned by ${short(slot.owner)}` : `Claim #${slot.id + 1}${isMega ? ` · ${priceLabel(slot.id)}` : ''}`}
          >
            {slot.imageUri
              ? <img src={slot.imageUri} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <span className="wall-slot__n">{slot.id + 1}{isMega && <span className="wall-slot__mega-tag">{colSpan}×</span>}</span>
            }
          </button>
        )
      })}
    </div>
  )

  const WallSection = ({ dim = false }: { dim?: boolean }) => (
    <section className={`wall-section${dim ? ' wall-section--dim' : ''}`}>
      {!dim && (
        <>
          <div className="wall-meta">
            <span className="stat-pill">{minted} claimed</span>
            <span className="stat-pill">{remaining} remaining</span>
            <span className="stat-pill">from 1 MON / spot</span>
            {balance && <span className="stat-pill">{Number(formatEther(balance.value)).toFixed(2)} MON</span>}
          </div>
          <p className="wall-hint">Click an open square to claim · Click an owned square to inspect · Gold = premium</p>
        </>
      )}
      <div className="wall-frame">
        <div className="wall-bg">
          <Image src="/1000nads-wall.svg" alt="" fill priority style={{ objectFit: 'contain' }} />
        </div>
        <GridSlots dim={dim} />
      </div>
    </section>
  )

  return (
    <div className="app-root">
      {/* Header */}
      <header className="site-header">
        <div className="site-header__inner">
          <div>
            <div className="site-logo">1000nads</div>
            <div className="site-tag">{siteCopy.tagline}</div>
          </div>
          <div className="header-right">
            <AmbientAudio />
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* ── GATE ── */}
      {phase === 'gate' && (
        <section className="gate-section">
          <div className="gate-bg" aria-hidden>
            <Image src="/1000nads-wall.svg" alt="" fill style={{ objectFit: 'cover' }} />
          </div>
          <div className="gate-center">
            <div className="gate-pills">
              <span className="stat-pill">{minted} claimed</span>
              <span className="stat-pill">{remaining} remaining</span>
              <span className="stat-pill">from 1 MON / spot</span>
            </div>
            <div className="game-card">
              <KeoneSprint onUnlock={() => setPhase('wall')} />
            </div>
            <button className="skip-btn" onClick={() => setPhase('wall')}>
              Skip &rarr; Go to map
            </button>
          </div>
        </section>
      )}

      {/* ── WALL ── */}
      {phase === 'wall' && <WallSection />}

      {/* ── FORM ── */}
      {phase === 'form' && selected && (
        <>
          <WallSection dim />
          <div className="modal-backdrop">
            <div className="claim-modal" role="dialog" aria-modal>
              <button className="modal-x" onClick={() => setPhase('wall')} aria-label="Close">✕</button>
              <div className="modal-head">
                {getMegaBlock(selected.id)
                  ? <span className="modal-badge modal-badge--premium">
                      {getMegaBlock(selected.id)!.colSpan === 6 ? '6-wide · 60 MON' : '4-wide · 40 MON'} · Premium
                    </span>
                  : <span className="modal-badge">Permanent Spot · 1 MON</span>
                }
                <div className="modal-num">#{selected.id + 1}</div>
                <div className="modal-sub">Write your name to the Monad chain. <strong>Forever.</strong></div>
              </div>
              <div className="modal-body">

                {/* Image upload */}
                <div className="modal-field">
                  <label className="modal-lbl">Your Image</label>
                  <div className="upload-zone" onClick={() => fileRef.current?.click()}>
                    {previewUri ? (
                      <div style={{ position: 'relative', width: '100%', height: '148px' }}>
                        <img src={previewUri} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '14px' }} />
                        <div className="upload-replace-hint">Click to replace</div>
                      </div>
                    ) : (
                      <div className="upload-empty">
                        <div className="upload-arrow">↑</div>
                        <div>Click to upload</div>
                        <div className="upload-fmt">JPG · PNG · WebP · max 3 MB</div>
                      </div>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
                  {preparing && <p className="modal-hint-txt">Preparing image…</p>}
                </div>

                {/* Twitter */}
                <div className="modal-field">
                  <label className="modal-lbl">X / Twitter <span className="modal-optional">optional</span></label>
                  <div className="twitter-input-wrap">
                    <span className="twitter-prefix">@</span>
                    <input
                      className="twitter-input"
                      value={twitter}
                      onChange={e => handleTwitterChange(e.target.value)}
                      placeholder="yourhandle"
                      maxLength={32}
                    />
                  </div>
                  {twitterWarn && (
                    <div className="twitter-warn">
                      Paste your username only, not the full URL.
                    </div>
                  )}
                </div>

                {/* Note */}
                <div className="modal-field">
                  <label className="modal-lbl">
                    Your Note
                    <span className="modal-counter">{encodeNote(twitter, note).length} / 96</span>
                  </label>
                  <input
                    className="modal-note"
                    value={note}
                    onChange={e => setNote(e.target.value.replace(/["\\\n\r\t]/g, ' ').slice(0, 96))}
                    placeholder="Leave your mark on the Monad wall…"
                  />
                  <div className="punct-hint">
                    <span className="punct-icon">ⓘ</span>
                    Quotes, backslashes &amp; line breaks are automatically removed
                  </div>
                </div>

                {/* TPS flash during confirmation */}
                {(isPending || confirming) && tpsCounter > 0 && (
                  <div className="tx-tps-flash">
                    <span className="tps-num">{tpsCounter.toLocaleString()}</span>
                    <span className="tps-label">TPS · Monad</span>
                  </div>
                )}

                {error && <div className="modal-err">{error}</div>}

                <button
                  className={`mint-btn${canMint ? ' mint-btn--go' : ' mint-btn--off'}`}
                  onClick={() => void handleMint()}
                  disabled={!canMint}
                >
                  {mintLabel}
                </button>

                {!isConnected && <div className="modal-connect-wrap"><ConnectButton /></div>}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── DONE ── */}
      {phase === 'done' && (
        <section className="done-section">
          <div className="done-card">
            <div className="done-check">✦</div>
            <h2 className="done-title">Your spot is secured forever.</h2>
            <p className="done-sub">Square #{selectedId !== null ? selectedId + 1 : ''} on the Monad wall — permanently yours.</p>
            {hash && (
              <a className="done-tx-link" href={`https://testnet.monadexplorer.com/tx/${hash}`} target="_blank" rel="noopener noreferrer">
                View on Monad Explorer →
              </a>
            )}
            <button className="done-wall-btn" onClick={() => setPhase('wall')}>See the wall</button>
          </div>
        </section>
      )}

      {/* ── INSPECT MODAL ── */}
      {inspectId !== null && inspected && (() => {
        const { twitter: tw, note: nt } = parseNote(inspected.note ?? '')
        return (
          <div className="inspect-backdrop" onClick={() => setInspectId(null)}>
            <div className="inspect-card" onClick={e => e.stopPropagation()}>
              <button className="inspect-close" onClick={() => setInspectId(null)}>✕</button>
              {inspected.imageUri && (
                <img src={inspected.imageUri} alt="PFP" className="inspect-img" />
              )}
              <div className="inspect-body">
                <div className="inspect-num">#{inspected.id + 1}</div>
                <div className="inspect-owner">{short(inspected.owner)}</div>
                {tw && (
                  <a className="inspect-twitter" href={`https://x.com/${tw}`} target="_blank" rel="noopener noreferrer">
                    @{tw}
                  </a>
                )}
                {nt && <div className="inspect-note">"{nt}"</div>}
                <div className="inspect-date">
                  {inspected.mintedAt
                    ? new Date(inspected.mintedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                    : 'Claimed on Monad Testnet'}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── FAUCET ── */}
      <footer className="faucet-section">
        <div className="faucet-inner">
          <div className="faucet-label">Faucet</div>
          <h3 className="faucet-title">Need testnet MON?</h3>
          <p className="faucet-desc">Get free MON tokens from the official Monad faucet. One spot costs 1 MON.</p>
          <a className="faucet-cta" href="https://buildanything.so/faucet" target="_blank" rel="noopener noreferrer">
            Request faucet MON →
          </a>
          <div className="builder-section">
            <span className="builder-label">Built by</span>
            <div className="builder-links">
              <a className="builder-link" href="https://x.com/gizdusumandnode" target="_blank" rel="noopener noreferrer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                @gizdusumandnode
              </a>
              <a className="builder-link" href="https://github.com/gizdusum" target="_blank" rel="noopener noreferrer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
                gizdusum
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
