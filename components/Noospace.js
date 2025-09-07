import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

const DAILY_LIMIT = 3
const MAX_CHARS = 240
const AIRDROP_PER_USER = 1600
const HARVEST_DAYS = 9

function formatDaysLeft(startTs) {
  const now = Date.now()
  const diff = Math.max(0, startTs + HARVEST_DAYS * 24 * 60 * 60 * 1000 - now)
  return Math.ceil(diff / (24 * 60 * 60 * 1000))
}

async function savePostToBackend(wallet, entry) {
  if (supabase && wallet) {
    try {
      const { data, error } = await supabase.from('posts').insert([{ owner: wallet, ...entry }])
      if (error) throw error
      return data[0]
    } catch (e) {
      console.warn('supabase insert failed', e)
    }
  }
  const list = JSON.parse(localStorage.getItem('noo_posts')||'[]')
  list.unshift({ wallet, ...entry })
  localStorage.setItem('noo_posts', JSON.stringify(list.slice(0,200)))
  return entry
}

async function fetchPostsFromBackend() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data
    } catch (e) {
      console.warn('supabase fetch failed', e)
    }
  }
  return JSON.parse(localStorage.getItem('noo_posts')||'[]')
}

async function addOrUpdateBalance(wallet, delta) {
  if (!wallet) return
  if (supabase) {
    try {
      // fetch existing
      const { data: existing } = await supabase.from('balances').select('*').eq('wallet', wallet).single()
      if (existing) {
        const newBal = (existing.balance || 0) + delta
        await supabase.from('balances').update({ balance: newBal }).eq('wallet', wallet)
        return { wallet, balance: newBal }
      } else {
        await supabase.from('balances').insert({ wallet, balance: delta })
        return { wallet, balance: delta }
      }
    } catch (e) {
      console.warn('supabase upsert balance failed', e)
    }
  }
  const balKey = 'noo_bal_' + wallet
  const cur = parseInt(localStorage.getItem(balKey) || '0', 10)
  localStorage.setItem(balKey, String(cur + delta))
  return { wallet, balance: cur + delta }
}

async function fetchBalance(wallet) {
  if (!wallet) return 0
  if (supabase) {
    try {
      const { data, error } = await supabase.from('balances').select('balance').eq('wallet', wallet).single()
      if (data && data.balance != null) return data.balance
    } catch (e) {
      console.warn('supabase fetch balance failed', e)
    }
  }
  const cur = parseInt(localStorage.getItem('noo_bal_' + wallet) || '0', 10)
  return cur
}

export default function NooSpace() {
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey ? publicKey.toBase58() : null
  const guest = !connected

  const [text, setText] = useState('')
  const [entries, setEntries] = useState([])
  const [usedToday, setUsedToday] = useState(0)
  const [startTs, setStartTs] = useState(() => {
    const v = localStorage.getItem('noo_start')
    if (v) return parseInt(v,10)
    const t = Date.now()
    localStorage.setItem('noo_start', String(t))
    return t
  })
  const [unclaimed, setUnclaimed] = useState(0)
  const [balance, setBalance] = useState(0)
  const [mantra, setMantra] = useState(true)
  const [farmedTotal, setFarmedTotal] = useState(0)

  useEffect(() => {
    fetchPostsFromBackend().then(setEntries)
    setUsedToday(parseInt(localStorage.getItem('noo_used')||'0',10))
    if (wallet) {
      fetchBalance(wallet).then(b => setBalance(b))
      // fetch unclaimed
      if (supabase) {
        supabase.from('unclaimed').select('amount').eq('wallet', wallet).single().then(res=> {
          if (res?.data) setUnclaimed(res.data.amount || 0)
        }).catch(()=>{})
      } else {
        setUnclaimed(parseInt(localStorage.getItem('noo_unclaimed_' + wallet)||'0',10))
      }
      // compute farmedTotal as balance + previously harvested (balance) + historical (simple sum from posts)
      if (supabase) {
        supabase.from('posts').select('reward').eq('owner', wallet).then(r => {
          const total = (r.data || []).reduce((s,p)=>s+(p.reward||0),0)
          setFarmedTotal(total + (balance||0))
        }).catch(()=>{})
      } else {
        const total = JSON.parse(localStorage.getItem('noo_posts')||'[]').filter(p=>p.wallet===wallet).reduce((s,p)=>s+(p.reward||0),0)
        setFarmedTotal(total + (balance||0))
      }
    }
  }, [wallet, balance])

  async function post() {
    if (usedToday >= DAILY_LIMIT) return alert("You have used today's orbs.")
    if (!text.trim()) return
    const base = 5
    const mult = mantra ? 1.4 : 1.0
    const reward = Math.round(base * mult)
    const entry = { id: Date.now(), text: text.trim(), reward, created_at: new Date().toISOString() }
    await savePostToBackend(wallet, entry)
    setEntries(prev => [entry, ...prev].slice(0,200))
    setUsedToday(prev => {
      const v = prev + 1
      localStorage.setItem('noo_used', String(v))
      return v
    })
    if (wallet) {
      if (supabase) {
        try {
          await supabase.from('unclaimed').upsert({ wallet, amount: reward }, { onConflict: ['wallet'] })
        } catch (e) { console.warn(e) }
      } else {
        const key = 'noo_unclaimed_' + wallet
        const cur = parseInt(localStorage.getItem(key)||'0',10)
        localStorage.setItem(key, String(cur + reward))
      }
      setUnclaimed(prev => prev + reward)
      setFarmedTotal(prev => prev + reward)
    } else {
      const cur = parseInt(localStorage.getItem('noo_shadow')||'0',10)
      localStorage.setItem('noo_shadow', String(cur + reward))
    }
    setText('')
  }

  async function harvestNowMock() {
    if (!wallet) return alert('Connect wallet to harvest your spores.')
    // call API endpoint to perform harvest (mock server-side payout)
    try {
      const res = await fetch('/api/harvest', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ wallet }) })
      const data = await res.json()
      if (data?.ok) {
        // refresh balance and unclaimed
        setBalance(await fetchBalance(wallet))
        setUnclaimed(0)
        alert('Harvest processed (mock). In production this would be batched on-chain.')
      } else {
        alert('Harvest failed: ' + (data?.error||'unknown'))
      }
    } catch (e) {
      alert('Harvest request failed (network).')
    }
  }

  const daysLeft = useMemo(() => formatDaysLeft(startTs), [startTs, entries])

  return (
    <div className="noo-wrap">
      <header className="noo-topbar">
        <div className="brand">
          <div className="logo">NOO</div>
          <div>
            <div className="title">NooSpace — Noosphere Protocol</div>
            <div className="subtitle">Resonance · Brevity · Ritual</div>
          </div>
        </div>
        <div className="status">
          <div className="balance">NOO Balance: <strong>{balance}</strong></div>
          <div className="farmed">Farmed total: <strong>{farmedTotal}</strong></div>
          {wallet ? <div className="wallet">Spore-bearer: {wallet.slice(0,6)}…{wallet.slice(-6)}</div> :
            <WalletMultiButton />}
        </div>
      </header>

      <main className="noo-main">
        <section className="ritual">
          <div className="orbs">
            {Array.from({ length: DAILY_LIMIT }).map((_, i) => <div key={i} className={'orb ' + (i < usedToday ? 'filled':'empty')} />)}
          </div>

          <div className="composer">
            <textarea value={text} onChange={e=>setText(e.target.value.slice(0,MAX_CHARS))} placeholder={guest ? "Guest shadow mode: post but connect to harvest later." : "Share a short resonant thought... (max 240 chars)"} rows={3} />
            <div className="composer-row">
              <label className="mantra"><input type="checkbox" checked={mantra} onChange={()=>setMantra(!mantra)} /> Speak with intent (mantra)</label>
              <div className="controls">
                <div className="chars">{text.length}/{MAX_CHARS}</div>
                <button className="post-btn" onClick={post} disabled={usedToday>=DAILY_LIMIT}>{guest ? 'Post (Guest Shadow)' : 'Post & Seed'}</button>
              </div>
            </div>

            <div className="harvest-box">
              <div>Your spores are germinating. Harvest in <strong>{daysLeft}</strong> dawns.</div>
              <div>Unclaimed seeds: <strong>{unclaimed}</strong></div>
              <div className="harvest-actions">
                <button onClick={harvestNowMock} disabled={!wallet}>Request Harvest (mock)</button>
              </div>
              <div className="airdrop-note">Genesis spore balance (per user): {AIRDROP_PER_USER} NOO (partial unlock over cycles)</div>
            </div>
          </div>
        </section>

        <section className="feed">
          <h3>Recent Thoughts</h3>
          <div className="entries">
            {entries.length === 0 && <div className="empty">No seeds yet — be the first to post.</div>}
            {entries.map((e, i) => (
              <div className={'entry ' + (e.highlighted ? 'highlight' : '')} key={e.id}>
                <div className="entry-text">{e.text}</div>
                <div className="entry-meta">
                  <div>+{e.reward} NOO</div>
                  <div className="resonate">
                    <button onClick={async ()=>{ try { if (supabase) { await supabase.from('posts').update({ resonates: (e.resonates||0)+1 }).eq('id', e.id) } } catch (err) { } }}>Resonate ({e.resonates||0})</button>
                    <button onClick={async ()=>{ if (!wallet) return alert('Connect to sacrifice.'); const ok = confirm('Sacrifice 20 NOO to highlight this post? (mock)'); if (!ok) return; await addOrUpdateBalance(wallet, -20); setBalance(await fetchBalance(wallet)); const newEntries = entries.map(x=> x.id===e.id?{...x,highlighted:true}:x); setEntries(newEntries) }} className="burn">Sacrifice 20 NOO</button>
                  </div>
                  <time>{new Date(e.created_at).toLocaleString()}</time>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="noo-footer">
        <div>NooSpace — A mycelial protocol for the planetary mind.</div>
        <div>Seeds, ritual, and resonance • Harvest cycles every {HARVEST_DAYS} days</div>
      </footer>
    </div>
  )
}