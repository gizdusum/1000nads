'use client'

import Image from 'next/image'
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  useAccount, useBalance, useChainId, useReadContract, useReadContracts,
  useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from 'wagmi'
import { formatEther } from 'viem'
import {
  CONTRACT_ADDRESS, GRID_COLUMNS, GRID_ROWS, SLOT_PRICE_WEI,
  TOTAL_SLOTS, WALL_ABI,
} from '@/lib/contracts'
import { siteCopy } from '@/lib/content'
import { createMockSlots } from '@/lib/mock-slots'
import { KeoneSprint } from '@/components/KeoneSprint'
import { AmbientAudio } from '@/components/AmbientAudio'

const ZERO = '0x0000000000000000000000000000000000000000'
const MONAD_ID = 10143
const UPLOAD_PX = 160

type Phase = 'gate' | 'wall' | 'form' | 'done'

function short(a: string | null) {
  if (!a) return 'available'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

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
  const webp = c.toDataURL('image/webp', 0.88)
  return webp.length <= 180000 ? webp : c.toDataURL('image/jpeg', 0.86)
}

function useSlots() {
  const contracts = useMemo(() =>
    CONTRACT_ADDRESS === ZERO ? [] :
    Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
      address: CONTRACT_ADDRESS, abi: WALL_ABI,
      functionName: 'spotData' as const, args: [BigInt(i)] as const,
    })), [])
  const { data, refetch } = useReadContracts({
    contracts, query: { enabled: contracts.length > 0, refetchInterval: 7000 },
  })
  const empty = useMemo(() => createMockSlots(TOTAL_SLOTS), [])
  const slots = useMemo(() => {
    if (!data || !contracts.length) return empty
    return empty.map((fb, i) => {
      const item = data[i]
      if (!item || item.status !== 'success') return fb
      const [owner, imageUri, note, isPermanent, mintedAt] = item.result as [string, string, string, boolean, bigint]
      if (owner === ZERO) return fb
      return { id: i, imageUri, owner, note, isPermanent, mintedAt: Number(mintedAt) * 1000 }
    })
  }, [contracts.length, data, empty])
  return { slots, refetch }
}

export function WallBoard() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const { slots, refetch } = useSlots()
  const { data: balance } = useBalance({ address, chainId: MONAD_ID, query: { enabled: !!address } })
  const { data: ownedMarker } = useReadContract({
    address: CONTRACT_ADDRESS, abi: WALL_ABI, functionName: 'walletToSlot',
    args: address ? [address] : undefined,
    query: { enabled: !!address && CONTRACT_ADDRESS !== ZERO, refetchInterval: 7000 },
  })

  const [phase, setPhase] = useState<Phase>('gate')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [inspectId, setInspectId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [previewUri, setPreviewUri] = useState('')
  const [imageUri, setImageUri] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const { writeContractAsync, data: hash, isPending } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!isSuccess) return
    setPhase('done'); setError(null); void refetch()
  }, [isSuccess, refetch])

  const minted = slots.filter(s => !!s.owner).length
  const remaining = TOTAL_SLOTS - minted
  const onChain = chainId === MONAD_ID
  const alreadyOwns = typeof ownedMarker === 'bigint' && ownedMarker > 0n
  const hasFunds = !!balance && balance.value >= SLOT_PRICE_WEI
  const selected = selectedId !== null ? slots[selectedId] : null
  const inspected = inspectId !== null ? slots[inspectId] : null

  const openForm = (id: number) => {
    setSelectedId(id); setNote(''); setPreviewUri(''); setImageUri(''); setError(null); setPhase('form')
  }

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setError(null); setPreparing(true)
    try {
      if (file.size > 3_000_000) throw new Error('Image must be under 3 MB.')
      const raw = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => typeof r.result === 'string' ? res(r.result) : rej(new Error('Read error'))
        r.onerror = () => rej(new Error('Read error')); r.readAsDataURL(file)
      })
      const out = await resizeImage(raw)
      if (out.length > 180000) throw new Error('Image too large after compression.')
      setPreviewUri(out); setImageUri(out)
    } catch (err) { setError(err instanceof Error ? err.message : 'Image error.') }
    finally { setPreparing(false) }
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
    if (!hasFunds) return setError('You need at least 1 MON on Monad testnet.')
    if (!imageUri) return setError('Upload an image first.')
    if (note.length > 96) return setError('Note must be under 96 characters.')
    try {
      await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: WALL_ABI, functionName: 'mintSpot',
        args: [BigInt(selected.id), imageUri, note, true], value: SLOT_PRICE_WEI,
      })
    } catch (err) { setError(err instanceof Error ? err.message : 'Mint failed.') }
  }

  const mintLabel = (() => {
    if (!isConnected) return 'Connect wallet first'
    if (!onChain) return switching ? 'Switching...' : 'Switch to Monad Testnet'
    if (alreadyOwns) return 'Wallet already owns a square'
    if (!hasFunds) return 'Need 1 MON — get from faucet below'
    if (preparing) return 'Preparing image...'
    if (!imageUri) return 'Upload an image to continue'
    if (isPending || confirming) return 'Confirming on Monad...'
    return '✦ Write my name to history'
  })()

  const canMint = isConnected && onChain && !alreadyOwns && hasFunds && !!imageUri &&
    !isPending && !confirming && !preparing && !selected?.owner

  const GridSlots = ({ dim = false }: { dim?: boolean }) => (
    <div
      className="wall-grid"
      style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}
    >
      {slots.map(slot => {
        const isSelected = slot.id === selectedId
        return (
          <button
            key={slot.id}
            type="button"
            className={`wall-slot${slot.owner ? ' wall-slot--owned' : ' wall-slot--open'}${isSelected ? ' wall-slot--active' : ''}`}
            onClick={() => {
              if (dim) return
              if (slot.owner) { setInspectId(slot.id) }
              else { openForm(slot.id) }
            }}
            title={slot.owner ? `Owned by ${short(slot.owner)}` : `Claim #${slot.id + 1}`}
          >
            {slot.imageUri
              ? <Image src={slot.imageUri} alt="" fill sizes="40px" unoptimized style={{ objectFit: 'cover' }} />
              : <span className="wall-slot__n">{slot.id + 1}</span>
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
            <span className="stat-pill">{formatEther(SLOT_PRICE_WEI)} MON / spot</span>
            {balance && <span className="stat-pill">{Number(formatEther(balance.value)).toFixed(2)} MON</span>}
          </div>
          <p className="wall-hint">Click an open square to claim your permanent spot · Click an owned square to inspect</p>
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
              <span className="stat-pill">{formatEther(SLOT_PRICE_WEI)} MON / spot</span>
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
                <span className="modal-badge">Permanent Spot</span>
                <div className="modal-num">#{selected.id + 1}</div>
                <div className="modal-sub">Your name on Monad. Forever.</div>
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

                {/* Note */}
                <div className="modal-field">
                  <label className="modal-lbl">
                    Your Note
                    <span className="modal-counter">{note.length} / 96</span>
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

      {/* ── INSPECT MODAL (owned PFP) ── */}
      {inspectId !== null && inspected && (
        <div className="inspect-backdrop" onClick={() => setInspectId(null)}>
          <div className="inspect-card" onClick={e => e.stopPropagation()}>
            <button className="inspect-close" onClick={() => setInspectId(null)}>✕</button>
            {inspected.imageUri && (
              <img src={inspected.imageUri} alt="PFP" className="inspect-img" />
            )}
            <div className="inspect-body">
              <div className="inspect-num">#{inspected.id + 1}</div>
              <div className="inspect-owner">{short(inspected.owner)}</div>
              {inspected.note && (
                <div className="inspect-note">"{inspected.note}"</div>
              )}
              <div className="inspect-date">
                {inspected.mintedAt
                  ? new Date(inspected.mintedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                  : 'Claimed on Monad Testnet'}
              </div>
            </div>
          </div>
        </div>
      )}

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
