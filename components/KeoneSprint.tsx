'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'

type Props = { onUnlock: () => void }
type Phase = 'intro' | 'playing' | 'won' | 'lost'
type Actor = {
  id: number; x: number; y: number; vx: number; vy: number
  radius: number; type: 'orb' | 'enemy'; angle: number
}

const GW = 980; const GH = 980
const TARGET = 10000; const ORB_VAL = 600; const HIT_PEN = 700

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

export function KeoneSprint({ onUnlock }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef  = useRef<number>()
  const keoneRef  = useRef<HTMLImageElement | null>(null)
  const johnRef   = useRef<HTMLImageElement | null>(null)
  const actorsRef = useRef<Actor[]>([])
  const txRef     = useRef(GW / 2)
  const lastRef   = useRef(0)
  const spawnRef  = useRef(0)
  const timeRef   = useRef(0)
  const phaseRef  = useRef<Phase>('intro')
  const nidRef    = useRef(1)
  const playerRef = useRef({ x: GW / 2, y: GH - 148, r: 56 })
  const scoreRef  = useRef(0)
  const livesRef  = useRef(3)

  const [phase, setPhase] = useState<Phase>('intro')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [flash, setFlash] = useState(false)

  const orbGrad = useMemo(() => [
    [0, '#fff8ff'], [0.38, '#c9aeff'], [1, '#6e3fff'],
  ] as const, [])

  useEffect(() => {
    const k = new window.Image(); k.src = '/keone.jpg'; keoneRef.current = k
    const j = new window.Image(); j.src = '/john.jpg'; johnRef.current = j
  }, [])

  const doReset = () => {
    actorsRef.current = []; txRef.current = GW / 2; lastRef.current = 0
    spawnRef.current = 0; timeRef.current = 0; nidRef.current = 1
    scoreRef.current = 0; livesRef.current = 3
    playerRef.current = { x: GW / 2, y: GH - 148, r: 56 }
    setScore(0); setLives(3); setFlash(false)
  }

  const doStart = () => { doReset(); phaseRef.current = 'playing'; setPhase('playing') }

  useEffect(() => {
    if (phase !== 'lost') return
    const t = window.setTimeout(doStart, 2000)
    return () => window.clearTimeout(t)
  }, [phase]) // eslint-disable-line

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return

    const render = (ts: number) => {
      if (!lastRef.current) lastRef.current = ts
      const dt = Math.min((ts - lastRef.current) / 1000, 0.04)
      lastRef.current = ts
      const p = playerRef.current
      p.x += (txRef.current - p.x) * Math.min(dt * 8.5, 1)

      if (phaseRef.current === 'playing') {
        timeRef.current += dt; spawnRef.current += dt
        if (timeRef.current > 30) { phaseRef.current = 'lost'; setPhase('lost') }

        if (spawnRef.current > 0.33) {
          spawnRef.current = 0
          const isEnemy = Math.random() > 0.84
          actorsRef.current.push({
            id: nidRef.current++,
            x: 100 + Math.random() * (GW - 200), y: -80,
            vx: (Math.random() - 0.5) * 72,
            vy: (isEnemy ? 215 : 172) + Math.random() * 115 + scoreRef.current * 0.008,
            radius: isEnemy ? 40 : 22, type: isEnemy ? 'enemy' : 'orb',
            angle: Math.random() * Math.PI * 2,
          })
        }

        actorsRef.current = actorsRef.current.filter(a => {
          a.x += a.vx * dt; a.y += a.vy * dt; a.angle += dt * 2.8
          if (a.x < 80 || a.x > GW - 80) a.vx *= -1
          const dx = a.x - p.x; const dy = a.y - p.y
          if (Math.sqrt(dx*dx+dy*dy) < a.radius + p.r - 10) {
            if (a.type === 'orb') {
              scoreRef.current = clamp(scoreRef.current + ORB_VAL, 0, TARGET)
              setScore(scoreRef.current)
              if (scoreRef.current >= TARGET) {
                phaseRef.current = 'won'; setPhase('won'); setFlash(true)
                setTimeout(() => onUnlock(), 500)
              }
            } else {
              livesRef.current -= 1; setLives(livesRef.current)
              scoreRef.current = clamp(scoreRef.current - HIT_PEN, 0, TARGET)
              setScore(scoreRef.current)
              if (livesRef.current <= 0) { phaseRef.current = 'lost'; setPhase('lost') }
            }
            return false
          }
          return a.y < GH + 120
        })
      }

      ctx.clearRect(0, 0, GW, GH)
      const bg = ctx.createLinearGradient(0, 0, 0, GH)
      bg.addColorStop(0, 'rgba(8,0,18,0.18)'); bg.addColorStop(1, 'rgba(8,0,18,0.84)')
      ctx.fillStyle = bg; ctx.fillRect(0, 0, GW, GH)
      ctx.strokeStyle = 'rgba(160,120,255,0.06)'; ctx.lineWidth = 1
      for (let i = 0; i <= 10; i++) {
        ctx.beginPath(); ctx.moveTo((GW/10)*i,0); ctx.lineTo((GW/10)*i,GH); ctx.stroke()
      }
      for (let i = 0; i < 20; i++) {
        const y = ((ts/4.2+i*98)%(GH+130))-130
        ctx.fillStyle=`rgba(180,140,255,${0.03+(i%4)*0.012})`
        ctx.fillRect((i%5)*196+88,y,5,34)
      }
      actorsRef.current.forEach(a => {
        if (a.type==='orb') {
          const glow=ctx.createRadialGradient(a.x,a.y,0,a.x,a.y,a.radius*2.2)
          glow.addColorStop(0,'rgba(120,80,255,0.38)'); glow.addColorStop(1,'rgba(120,80,255,0)')
          ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(a.x,a.y,a.radius*2.2,0,Math.PI*2); ctx.fill()
          const g=ctx.createRadialGradient(a.x-4,a.y-4,2,a.x,a.y,a.radius)
          orbGrad.forEach(([s,c])=>g.addColorStop(s as number,c as string))
          ctx.fillStyle=g; ctx.beginPath(); ctx.arc(a.x,a.y,a.radius,0,Math.PI*2); ctx.fill()
          ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font=`700 ${Math.round(a.radius*.68)}px IBM Plex Mono,monospace`
          ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('TPS',a.x,a.y)
        } else if (johnRef.current) {
          ctx.save(); ctx.translate(a.x,a.y); ctx.rotate(Math.sin(a.angle)*.22)
          const eg=ctx.createRadialGradient(0,0,0,0,0,a.radius*2.2)
          eg.addColorStop(0,'rgba(255,50,50,0.28)'); eg.addColorStop(1,'rgba(255,50,50,0)')
          ctx.fillStyle=eg; ctx.beginPath(); ctx.arc(0,0,a.radius*2.2,0,Math.PI*2); ctx.fill()
          ctx.beginPath(); ctx.arc(0,0,a.radius,0,Math.PI*2); ctx.closePath(); ctx.clip()
          ctx.drawImage(johnRef.current,-a.radius,-a.radius,a.radius*2,a.radius*2); ctx.restore()
        }
      })
      const pg=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*1.8)
      pg.addColorStop(0,'rgba(130,95,255,0.35)'); pg.addColorStop(1,'rgba(130,95,255,0)')
      ctx.fillStyle=pg; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*1.8,0,Math.PI*2); ctx.fill()
      if (keoneRef.current) {
        ctx.save(); ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.closePath(); ctx.clip()
        ctx.drawImage(keoneRef.current,p.x-p.r,p.y-p.r,p.r*2,p.r*2); ctx.restore()
        ctx.strokeStyle='rgba(200,175,255,0.85)'; ctx.lineWidth=3
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.stroke()
      }
      const bx=44,by=38,bw=GW-88,bh=16
      ctx.fillStyle='rgba(255,255,255,0.07)'; ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,8); ctx.fill()
      const prog=scoreRef.current/TARGET
      if (prog>0) {
        const pg2=ctx.createLinearGradient(bx,0,bx+bw,0)
        pg2.addColorStop(0,'#6030d0'); pg2.addColorStop(1,'#c0a0ff')
        ctx.fillStyle=pg2; ctx.beginPath(); ctx.roundRect(bx,by,bw*prog,bh,8); ctx.fill()
      }
      ctx.textAlign='left'; ctx.textBaseline='alphabetic'
      ctx.fillStyle='#f0eaff'; ctx.font='700 30px IBM Plex Mono,monospace'
      ctx.fillText(`${scoreRef.current.toLocaleString()} / 10,000 TPS`,44,96)
      ctx.font='500 18px IBM Plex Mono,monospace'; ctx.fillStyle='rgba(240,234,255,0.6)'
      ctx.textAlign='right'; ctx.fillText('♥'.repeat(Math.max(0,livesRef.current)),GW-44,96)
      frameRef.current=window.requestAnimationFrame(render)
    }
    frameRef.current=window.requestAnimationFrame(render)
    return () => { if (frameRef.current) window.cancelAnimationFrame(frameRef.current) }
  }, [onUnlock, orbGrad])

  useEffect(() => {
    const move=(cx:number,rect:DOMRect)=>{
      txRef.current=clamp(((cx-rect.left)/rect.width)*GW,100,GW-100)
    }
    const onPtr=(e:PointerEvent)=>{
      const c=canvasRef.current; if(!c||phaseRef.current!=='playing') return
      move(e.clientX,c.getBoundingClientRect())
    }
    const onTch=(e:TouchEvent)=>{
      const c=canvasRef.current; if(!c||phaseRef.current!=='playing') return
      const t=e.touches[0]; if(t) move(t.clientX,c.getBoundingClientRect())
    }
    window.addEventListener('pointermove',onPtr)
    window.addEventListener('touchmove',onTch,{passive:true})
    return ()=>{ window.removeEventListener('pointermove',onPtr); window.removeEventListener('touchmove',onTch) }
  }, [])

  return (
    <div className={`ks-shell${flash?' ks-flash':''}`}>
      <canvas ref={canvasRef} width={GW} height={GH} className="ks-canvas" />

      {phase !== 'playing' && (
        <div className="ks-overlay">
          {phase === 'intro' && (
            <>
              <span className="ks-badge">Monad Gate</span>
              <h2 className="ks-headline">Prove your speed.<br/>Earn your spot.</h2>

              {/* Premium how-to-play guide */}
              <div className="ks-howto">
                <div className="ks-howto-card ks-howto-card--green">
                  <div className="ks-howto-icon">
                    <Image src="/keone.jpg" alt="Keone" width={44} height={44} style={{ borderRadius:'50%', border:'2px solid rgba(74,222,128,0.4)' }} />
                  </div>
                  <div className="ks-howto-tag">You</div>
                  <div className="ks-howto-title">Steer Keone</div>
                  <div className="ks-howto-desc">Move your cursor or drag to guide Keone across the lane</div>
                </div>

                <div className="ks-howto-card ks-howto-card--purple">
                  <div className="ks-howto-icon">
                    <div className="ks-howto-orb">TPS</div>
                  </div>
                  <div className="ks-howto-tag">Collect</div>
                  <div className="ks-howto-title">TPS Orbs</div>
                  <div className="ks-howto-desc">Each orb gives <strong>+{ORB_VAL} TPS</strong> toward your 10,000 target</div>
                </div>

                <div className="ks-howto-card ks-howto-card--red">
                  <div className="ks-howto-icon">
                    <Image src="/john.jpg" alt="John" width={44} height={44} style={{ borderRadius:'50%', border:'2px solid rgba(248,113,113,0.4)' }} />
                  </div>
                  <div className="ks-howto-tag">Avoid</div>
                  <div className="ks-howto-title">John</div>
                  <div className="ks-howto-desc">Each hit costs <strong>−{HIT_PEN} TPS</strong> and −1 life. Three hits = restart</div>
                </div>
              </div>

              <div className="ks-goal-pill">🎯 Hit 10,000 TPS to unlock the wall</div>
              <button className="ks-start-btn" onClick={doStart}>Start Trial</button>
            </>
          )}
          {phase === 'lost' && (
            <>
              <span className="ks-badge ks-badge--fail">Trial Failed</span>
              <h2 className="ks-headline">Stay sharp.<br/>Restarting...</h2>
            </>
          )}
          {phase === 'won' && (
            <>
              <span className="ks-badge ks-badge--win">Access Granted</span>
              <h2 className="ks-headline">Wall unlocked.</h2>
            </>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <div className="ks-hud">
          <span>Move cursor to steer Keone</span>
          <span>Collect TPS orbs · Avoid John</span>
        </div>
      )}
    </div>
  )
}
