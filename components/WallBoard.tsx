'use client'

import React, { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  useAccount, useBalance, useChainId, useReadContract,
  useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from 'wagmi'
import { formatEther } from 'viem'
import {
  CONTRACT_ADDRESS, getMegaBlock, getMintPrice, GRID_COLUMNS, GRID_ROWS,
  isHiddenSlot, MEGA_PRICE_4W, MEGA_PRICE_6W, SLOT_PRICE_WEI,
  TOTAL_SLOTS, WALL_ABI,
} from '@/lib/contracts'
import { createMockSlots, type Slot } from '@/lib/mock-slots'
import { KeoneSprint } from '@/components/KeoneSprint'
import { AmbientAudio } from '@/components/AmbientAudio'
import Image from 'next/image'
import type { SlotData } from '@/app/api/slots/route'

const ZERO      = '0x0000000000000000000000000000000000000000'
const MONAD_ID  = 10143
const UPLOAD_PX = 160

type Phase = 'gate' | 'wall' | 'form' | 'done'

// ── Fetch slots from server API (server handles all RPC + caching) ─────────────

async function fetchSlotsFromApi(current: Slot[], empty: Slot[]): Promise<Slot[]> {
  try {
    const res = await fetch('/api/slots', { cache: 'no-store' })
    if (!res.ok) return current
    const data: SlotData[] = await res.json()
    // Merge into current: only update slots the API has data for.
    // Never clear a slot to null — a null API entry could be a transient RPC failure,
    // not a confirmed empty slot.
    const next: Slot[] = current.map(s => ({ ...s }))
    data.forEach((d, i) => {
      if (d) next[i] = { id: d.id, imageUri: d.imageUri, owner: d.owner, note: d.note, isPermanent: d.isPermanent, mintedAt: d.mintedAt }
    })
    return next
  } catch {
    return current
  }
}

// ── Note encode/decode ────────────────────────────────────────────────────────

function encodeNote(twitter: string, note: string): string {
  const t = twitter.trim(); const n = note.trim()
  if (t && n) return `@${t}|${n}`
  if (t)      return `@${t}`
  return n
}

function parseNote(raw: string): { twitter: string; note: string } {
  if (!raw) return { twitter: '', note: '' }
  if (raw.startsWith('@')) {
    const pipe = raw.indexOf('|')
    if (pipe !== -1) return { twitter: raw.slice(1, pipe), note: raw.slice(pipe + 1) }
    return { twitter: raw.slice(1), note: '' }
  }
  return { twitter: '', note: raw }
}

// ── Image resize ──────────────────────────────────────────────────────────────

async function resizeImage(src: string) {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new window.Image()
    i.onload = () => res(i); i.onerror = () => rej(new Error('Load failed')); i.src = src
  })
  const c = document.createElement('canvas')
  c.width = UPLOAD_PX; c.height = UPLOAD_PX
  const ctx = c.getContext('2d')!
  const s = Math.max(UPLOAD_PX / img.width, UPLOAD_PX / img.height)
  const w = img.width * s; const h = img.height * s
  ctx.fillStyle = '#140026'; ctx.fillRect(0, 0, UPLOAD_PX, UPLOAD_PX)
  ctx.drawImage(img, (UPLOAD_PX - w) / 2, (UPLOAD_PX - h) / 2, w, h)
  const webp = c.toDataURL('image/webp', 0.85)
  if (webp.length <= 150000) return webp
  const jpeg = c.toDataURL('image/jpeg', 0.80)
  if (jpeg.length <= 150000) return jpeg
  // aggressive compress
  c.width = 120; c.height = 120
  const ctx2 = c.getContext('2d')!
  ctx2.fillStyle = '#140026'; ctx2.fillRect(0, 0, 120, 120)
  ctx2.drawImage(img, (120 - w * 120/160) / 2, (120 - h * 120/160) / 2, w * 120/160, h * 120/160)
  return c.toDataURL('image/jpeg', 0.70)
}

// ── useSlots ──────────────────────────────────────────────────────────────────

function useSlots() {
  const empty = useMemo(() => createMockSlots(TOTAL_SLOTS), [])
  const [slots, setSlots]         = useState<Slot[]>(empty)
  const slotsRef                  = useRef<Slot[]>(empty)
  const [txPending, setTxPending] = useState(false)

  const fetchSlots = useCallback(async () => {
    const next = await fetchSlotsFromApi(slotsRef.current, empty)
    slotsRef.current = next
    setSlots(next)
  }, [empty])

  useEffect(() => { void fetchSlots() }, [fetchSlots])

  useEffect(() => {
    if (txPending) return
    const iv = setInterval(() => void fetchSlots(), 6000)
    return () => clearInterval(iv)
  }, [fetchSlots, txPending])

  const updateSlot = useCallback((slot: Slot) => {
    setSlots(prev => {
      const next = [...prev]
      next[slot.id] = slot
      slotsRef.current = next
      return next
    })
  }, [])

  return { slots, refetch: fetchSlots, updateSlot, setTxPending }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function short(a: string | null) {
  if (!a) return 'available'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function priceLabel(slotId: number) {
  const p = getMintPrice(slotId)
  const mb = getMegaBlock(slotId)
  if (mb?.colSpan === 8) return `${mb.colSpan}-wide · 60 MON`
  if (p === MEGA_PRICE_6W) return '6-wide · 60 MON'
  if (p === MEGA_PRICE_4W) return '4-wide · 40 MON'
  return '1 MON'
}

// ── WallBoard ─────────────────────────────────────────────────────────────────

export function WallBoard() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const { slots, refetch, updateSlot, setTxPending } = useSlots()

  const { data: balance } = useBalance({
    address, chainId: MONAD_ID,
    query: { enabled: !!address, staleTime: 15000 },
  })

  const { data: ownedMarker } = useReadContract({
    address: CONTRACT_ADDRESS, abi: WALL_ABI, functionName: 'walletToSlot',
    args: address ? [address] : undefined,
    query: { enabled: !!address && CONTRACT_ADDRESS !== ZERO, refetchInterval: 8000 },
  })

  const [phase, setPhase]           = useState<Phase>('gate')
  const [gameUnlocked, setGameUnlocked] = useState(false)
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

  // Auto-switch to Monad Testnet when wallet connects
  useEffect(() => {
    if (isConnected && chainId !== MONAD_ID) {
      switchChainAsync({ chainId: MONAD_ID }).catch(() => {})
    }
  }, [isConnected, chainId, switchChainAsync])

  // Pause slot polling during tx flight
  useEffect(() => {
    setTxPending(isPending || confirming)
  }, [isPending, confirming, setTxPending])

  // After confirmed: immediately update cache + show done
  useEffect(() => {
    if (!isSuccess || selectedId === null || !address || !imageUri) return
    const combinedNote = encodeNote(twitter, note)
    updateSlot({
      id: selectedId,
      imageUri,
      owner: address,
      note: combinedNote,
      isPermanent: true,
      mintedAt: Date.now(),
    })
    setPhase('done')
    setError(null)
    setTimeout(() => void refetch(), 5000) // delayed background refresh
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  const minted    = slots.filter(s => !!s.owner).length
  const remaining = TOTAL_SLOTS - minted
  const onChain   = chainId === MONAD_ID
  const alreadyOwns = typeof ownedMarker === 'bigint' && ownedMarker > 0n
  const selected    = selectedId !== null ? slots[selectedId] : null
  const inspected   = inspectId  !== null ? slots[inspectId]  : null
  const mintPrice   = selectedId !== null ? getMintPrice(selectedId) : SLOT_PRICE_WEI
  const hasFunds    = !!balance && balance.value >= mintPrice

  const openForm = useCallback((id: number) => {
    if (!gameUnlocked) { setPhase('gate'); return }
    setSelectedId(id); setNote(''); setTwitter(''); setTwitterWarn(false)
    setPreviewUri(''); setImageUri(''); setError(null); setPhase('form')
  }, [gameUnlocked])

  const handleTwitterChange = (val: string) => {
    setTwitterWarn(/https?:\/\/|x\.com|twitter\.com/.test(val))
    setTwitter(val.replace(/[@/\s]/g, '').slice(0, 30))
  }

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setError(null); setPreparing(true)
    try {
      if (file.size > 5_000_000) throw new Error('Image must be under 5 MB.')
      const raw = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => typeof r.result === 'string' ? res(r.result) : rej(new Error())
        r.onerror = () => rej(new Error('Read error'))
        r.readAsDataURL(file)
      })
      const out = await resizeImage(raw)
      if (out.length > 150000) throw new Error('Image too large after compression. Try a smaller file.')
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
    if (!hasFunds) return setError(`You need at least ${formatEther(mintPrice)} MON.`)
    if (!imageUri)  return setError('Upload an image first.')
    const combinedNote = encodeNote(twitter, note)
    if (combinedNote.length > 96) return setError('Note too long (max 96 chars combined).')
    try {
      await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: WALL_ABI, functionName: 'mintSpot',
        args: [BigInt(selected.id), imageUri, combinedNote, true],
        value: mintPrice,
      })
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Mint failed.'
      if (raw.includes('wallet already owns slot')) {
        setError('This wallet already owns a square. One slot per wallet — forever.')
      } else if (raw.includes('slot already claimed')) {
        setError('Slot just claimed by someone else. Pick a different square.')
      } else if (raw.includes('wrong price')) {
        setError('Price mismatch. Please refresh the page and try again.')
      } else if (raw.includes('unsafe note')) {
        setError('Note contains invalid characters. Remove quotes, backslashes, or special symbols.')
      } else if (raw.includes('insufficient') || raw.includes('Insufficient')) {
        setError('Insufficient MON. You need at least 1.1 MON (1 MON + gas) to mint.')
      } else if (raw.includes('rate limit') || raw.includes('limit exceeded')) {
        setError('Monad RPC is busy. Wait 10 seconds and try again.')
      } else {
        setError(raw.slice(0, 160))
      }
    }
  }

  const mintLabel = (() => {
    if (!isConnected) return 'Connect wallet first'
    if (!onChain)     return switching ? 'Switching...' : 'Switch to Monad Testnet'
    if (alreadyOwns)  return 'Wallet already owns a square'
    if (!hasFunds)    return `Need ${formatEther(mintPrice)} MON — Get TestMON above`
    if (preparing)    return 'Preparing image...'
    if (!imageUri)    return 'Upload an image to continue'
    if (isPending)    return 'Approve in wallet...'
    if (confirming)   return 'Writing to Monad chain...'
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
        const mega    = getMegaBlock(slot.id)
        const colSpan = mega?.colSpan ?? 1
        const rowSpan = mega?.rowSpan ?? 1
        const isSelected = slot.id === selectedId
        const isMega  = colSpan > 1
        const isAnago = slot.id === 142

        const spanStyle: React.CSSProperties = {}
        if (colSpan > 1) spanStyle.gridColumn = `span ${colSpan}`
        if (rowSpan > 1) spanStyle.gridRow    = `span ${rowSpan}`

        return (
          <button
            key={slot.id}
            type="button"
            className={[
              'wall-slot',
              slot.owner || isAnago ? 'wall-slot--owned' : 'wall-slot--open',
              isSelected  ? 'wall-slot--active' : '',
              isMega      ? `wall-slot--mega wall-slot--mega-${colSpan}` : '',
            ].filter(Boolean).join(' ')}
            style={Object.keys(spanStyle).length ? spanStyle : undefined}
            onClick={() => {
              if (dim) return
              if (isAnago) { setInspectId(142); return }
              if (slot.owner) setInspectId(slot.id)
              else openForm(slot.id)
            }}
            title={isAnago ? 'Anago · Keone\'s dog · Reserved forever' : slot.owner
              ? `Owned by ${short(slot.owner)}`
              : gameUnlocked
                ? `Claim #${slot.id + 1}${isMega ? ` · ${priceLabel(slot.id)}` : ''}`
                : `#${slot.id + 1} · Beat the game to claim`
            }
          >
            {(isAnago || slot.imageUri)
              ? <img src={isAnago ? '/143.webp' : (slot.imageUri ?? '')} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
              : <span className="wall-slot__n">
                  {slot.id + 1}
                  {isMega && <span className="wall-slot__mega-tag">{colSpan}×</span>}
                </span>
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
          <p className="wall-hint">
            {gameUnlocked
              ? 'Click an open square to claim · Click an owned square to inspect · Gold border = premium block'
              : '👁 Browse mode — beat the game to unlock minting · Click an owned square to inspect'}
          </p>
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
            <div className="site-logo">
              <span className="logo-num">1000</span>nads.xyz
            </div>
            <div className="site-tag">Be immortal on Monad. Forever.</div>
          </div>
          <div className="header-right">
            <AmbientAudio />
            <a className="header-faucet-btn" href="https://buildanything.so/faucet" target="_blank" rel="noopener noreferrer">
              Get TestMON
            </a>
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
              <KeoneSprint onUnlock={() => { setGameUnlocked(true); setPhase('wall') }} />
            </div>
            <button className="skip-btn" onClick={() => setPhase('wall')}>
              Skip → Browse wall (read-only)
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
                      {getMegaBlock(selected.id)!.colSpan}-wide · {formatEther(mintPrice)} MON · Premium
                    </span>
                  : <span className="modal-badge">Permanent Spot · 1 MON</span>
                }
                <div className="modal-num">#{selected.id + 1}</div>
                <div className="modal-sub">Write your name to the Monad chain. <strong>Forever.</strong></div>
              </div>
              <div className="modal-body">

                {/* Image */}
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
                        <div className="upload-fmt">JPG · PNG · WebP · max 5 MB</div>
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
                    <div className="twitter-warn">Paste your username only, not the full URL.</div>
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
                    onChange={e => setNote(e.target.value.replace(/["\\\x00-\x1f]/g, ' ').slice(0, 96))}
                    placeholder="Leave your mark on the Monad wall…"
                  />
                  <div className="punct-hint">
                    <span className="punct-icon">ⓘ</span>
                    Quotes, backslashes &amp; line breaks are auto-removed
                  </div>
                </div>


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
            <p className="done-sub">
              Square #{selectedId !== null ? selectedId + 1 : ''} on the Monad wall — permanently yours.
            </p>
            {hash && (
              <a className="done-tx-link" href={`https://testnet.monadexplorer.com/tx/${hash}`} target="_blank" rel="noopener noreferrer">
                View on Monad Explorer →
              </a>
            )}
            <button className="done-wall-btn" onClick={() => setPhase('wall')}>See the wall</button>
          </div>
        </section>
      )}

      {/* ── INSPECT ── */}
      {inspectId !== null && inspected && (() => {
        if (inspectId === 142) return (
          <div className="inspect-backdrop" onClick={() => setInspectId(null)}>
            <div className="inspect-card" onClick={e => e.stopPropagation()}>
              <button className="inspect-close" onClick={() => setInspectId(null)}>✕</button>
              <img src="/143.webp" alt="Anago" className="inspect-img" style={{ objectFit: 'cover' }} />
              <div className="inspect-body">
                <div className="inspect-num">Anago 🐕</div>
                <div className="inspect-note">"We love you, Anago. Keone's loyal companion — forever immortalized on Monad."</div>
                <div className="inspect-date" style={{ marginTop: 8 }}>
                  Reserved · Cannot be claimed · Lives here forever
                </div>
                <a className="inspect-twitter" href="https://x.com/keoneHD" target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>
                  @keoneHD
                </a>
              </div>
            </div>
          </div>
        )

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

      {/* ── GHOST TPS OVERLAY ── */}
      {(isPending || confirming) && (
        <div className="ghost-tps-overlay">
          <GhostTpsCounter />
        </div>
      )}

      {/* ── FOOTER ── */}
      <footer className="site-footer">
        <p className="footer-inspire">
          Inspired by{' '}
          <a href="https://www.milliondollarhomepage.com" target="_blank" rel="noopener noreferrer">milliondollarhomepage.com</a>
          {' '}· Built with{' '}
          <a href="https://x.com/buildanythingso" target="_blank" rel="noopener noreferrer">Build Anything</a>
          {' '}education
        </p>
        <div className="footer-links">
          <a href="https://x.com/gizdusumandnode" target="_blank" rel="noopener noreferrer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            @gizdusumandnode
          </a>
          <a href="https://github.com/gizdusum" target="_blank" rel="noopener noreferrer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
            gizdusum
          </a>
        </div>
      </footer>
    </div>
  )
}

// ── Ghost TPS Counter (floating overlay) ─────────────────────────────────────

function GhostTpsCounter() {
  const baseRef = useRef(9200 + Math.floor(Math.random() * 400))
  const [tps, setTps] = useState(baseRef.current)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      setTps(() => {
        // Gradually climb toward 10500, with realistic noise
        if (baseRef.current < 10500) baseRef.current += Math.floor(Math.random() * 60 + 10)
        const noise = Math.floor(Math.random() * 280 - 140)
        return Math.max(9000, baseRef.current + noise)
      })
    }, 600)
    return () => clearInterval(iv)
  }, [])

  const pad = (n: number) => String(n).padStart(2, '0')
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const progress = Math.min(tps / 10500, 1)

  return (
    <div className="ghost-tps-card">
      <div className="ghost-tps-pulse" />
      <div className="ghost-tps-top">
        <span className="ghost-tps-chain">Monad Testnet</span>
        <span className="ghost-tps-dot" />
        <span className="ghost-tps-live">LIVE</span>
      </div>
      <div className="ghost-tps-number">{tps.toLocaleString()}</div>
      <div className="ghost-tps-unit">transactions / second</div>
      <div className="ghost-tps-bar">
        <div className="ghost-tps-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="ghost-tps-footer">
        <span className="ghost-tps-timer">{pad(mins)}:{pad(secs)}</span>
        <span className="ghost-tps-status">onchain · awaiting confirmation</span>
      </div>
    </div>
  )
}
