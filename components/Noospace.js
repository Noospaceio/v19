import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const DAILY_LIMIT = 3;
const MAX_CHARS = 240;
const AIRDROP_PER_USER = 1600;
const HARVEST_DAYS = 9;

// --- Backend helpers ---
async function savePostToBackend(wallet, entry) {
  try {
    const { data, error } = await supabase
      .from('posts')
      .insert([{ owner: wallet || null, ...entry }])
      .select();
    if (error) throw error;
    return data[0];
  } catch (e) {
    console.warn('Supabase insert failed', e);
    return null;
  }
}

async function fetchPostsFromBackend() {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('Supabase fetch failed', e);
    return [];
  }
}

async function fetchBalance(wallet) {
  if (!wallet) return 0;
  try {
    const { data } = await supabase.from('balances').select('balance').eq('wallet', wallet).single();
    return data?.balance ?? 0;
  } catch (e) {
    return 0;
  }
}

async function addOrUpdateBalance(wallet, delta) {
  if (!wallet) return 0;
  try {
    const { data: existing } = await supabase.from('balances').select('balance').eq('wallet', wallet).single();
    const newBalance = (existing?.balance || 0) + delta;
    await supabase.from('balances').upsert({ wallet, balance: newBalance }, { onConflict: ['wallet'] });
    return newBalance;
  } catch (e) {
    return 0;
  }
}

async function addOrUpdateUnclaimed(wallet, delta) {
  if (!wallet) return 0;
  try {
    const { data: existing } = await supabase.from('unclaimed').select('amount').eq('wallet', wallet).single();
    const newAmount = (existing?.amount || 0) + delta;
    await supabase.from('unclaimed').upsert({ wallet, amount: newAmount }, { onConflict: ['wallet'] });
    return newAmount;
  } catch (e) {
    return 0;
  }
}

// --- Daily usage helpers ---
async function fetchUsedToday(wallet) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supabase.from('daily_usage').select('*').eq('wallet', wallet).single();
    if (!data) return 0;
    return data.last_post_date === today ? data.used_count : 0;
  } catch {
    return 0;
  }
}

async function incrementUsedToday(wallet) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supabase.from('daily_usage').select('*').eq('wallet', wallet).single();
    if (!data || data.last_post_date !== today) {
      await supabase.from('daily_usage').upsert({ wallet, used_count: 1, last_post_date: today }, { onConflict: ['wallet'] });
      return 1;
    } else {
      const newCount = data.used_count + 1;
      await supabase.from('daily_usage').update({ used_count: newCount }).eq('wallet', wallet);
      return newCount;
    }
  } catch {
    return 0;
  }
}

// --- React component ---
export default function NooSpace() {
  const { publicKey } = useWallet();
  const wallet = publicKey ? publicKey.toBase58() : null;
  const guest = !wallet;

  const [text, setText] = useState('');
  const [entries, setEntries] = useState([]);
  const [usedToday, setUsedToday] = useState(0);
  const [startTs, setStartTs] = useState(Date.now());
  const [unclaimed, setUnclaimed] = useState(0);
  const [balance, setBalance] = useState(0);
  const [mantra, setMantra] = useState(true);
  const [farmedTotal, setFarmedTotal] = useState(0);
  const [daysLeft, setDaysLeft] = useState(HARVEST_DAYS);

  // Fetch posts + balances + daily usage + unclaimed + wallet start_ts
  useEffect(() => {
    fetchPostsFromBackend().then(setEntries);

    if (wallet) {
      fetchUsedToday(wallet).then(setUsedToday);
      fetchBalance(wallet).then(setBalance);

      supabase.from('unclaimed').select('amount').eq('wallet', wallet).single()
        .then(res => setUnclaimed(res.data?.amount || 0))
        .catch(() => setUnclaimed(0));

      supabase.from('posts').select('reward').eq('owner', wallet)
        .then(r => setFarmedTotal((r.data || []).reduce((s, p) => s + (p.reward || 0), 0)))
        .catch(() => {});

      // Wallet start_ts
      supabase.from('wallets').select('start_ts').eq('wallet', wallet).single()
        .then(res => {
          if (res.data?.start_ts) setStartTs(res.data.start_ts);
          else {
            const ts = Date.now();
            supabase.from('wallets').insert({ wallet, start_ts: ts }).then(() => setStartTs(ts));
          }
        })
        .catch(() => setStartTs(Date.now()));
    } else {
      setUsedToday(parseInt(localStorage.getItem('noo_used') || '0', 10));
    }
  }, [wallet]);

  // Berechne Tage bis Harvest
  useEffect(() => {
    const updateDaysLeft = () => {
      const now = Date.now();
      const diff = Math.max(0, startTs + HARVEST_DAYS * 24 * 60 * 60 * 1000 - now);
      setDaysLeft(Math.ceil(diff / (24 * 60 * 60 * 1000)));
    };
    updateDaysLeft();
    const interval = setInterval(updateDaysLeft, 60_000);
    return () => clearInterval(interval);
  }, [startTs]);

  async function post() {
    if (!guest && usedToday >= DAILY_LIMIT) return alert("You have used today's orbs.");
    if (!text.trim()) return;

    const base = 5;
    const mult = mantra ? 1.4 : 1.0;
    const reward = Math.round(base * mult);
    const entry = { text: text.trim(), reward, created_at: new Date().toISOString() };

    const saved = await savePostToBackend(wallet, entry);
    if (!saved) return alert('Failed to save post.');

    setEntries(prev => [saved, ...prev].slice(0, 200));

    if (!guest) {
      const newCount = await incrementUsedToday(wallet);
      setUsedToday(newCount);
      const newUnclaimed = await addOrUpdateUnclaimed(wallet, reward);
      setUnclaimed(newUnclaimed);
      const newBalance = await addOrUpdateBalance(wallet, reward);
      setBalance(newBalance);
      setFarmedTotal(prev => prev + reward);
    } else {
      setUsedToday(prev => { localStorage.setItem('noo_used', String(prev + 1)); return prev + 1; });
    }

    setText('');
  }

  async function harvestNow() {
    if (!wallet) return alert('Connect wallet to harvest your spores.');
    if (daysLeft > 0) return alert(`Harvest not ready. ${daysLeft} days left.`);

    try {
      const res = await fetch('/api/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
      const data = await res.json();
      if (data?.ok) {
        setBalance(await fetchBalance(wallet));
        setUnclaimed(0);
        setFarmedTotal(0);
        alert(`Harvest successful! You gained ${data.harvested} NOO.`);
      } else alert('Harvest failed: ' + (data?.error || 'unknown'));
    } catch {
      alert('Harvest request failed (network).');
    }
  }

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
            {Array.from({ length: DAILY_LIMIT }).map((_, i) =>
              <div key={i} className={'orb ' + (i < usedToday ? 'filled' : 'empty')} />)}
          </div>

          <div className="composer">
            <textarea value={text} onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
              placeholder={guest ? "Guest mode: post and see everything." : "Share a short resonant thought... (max 240 chars)"} rows={3} />
            <div className="composer-row">
              <label className="mantra">
                <input type="checkbox" checked={mantra} onChange={() => setMantra(!mantra)} /> Speak with intent (mantra)
              </label>
              <div className="controls">
                <div className="chars">{text.length}/{MAX_CHARS}</div>
                <button className="post-btn" onClick={post} disabled={usedToday >= DAILY_LIMIT}>Post & Seed</button>
              </div>
            </div>

            <div className="harvest-box">
              <div>Your spores are germinating. Harvest in <strong>{daysLeft}</strong> dawns.</div>
              <div>Unclaimed seeds: <strong>{unclaimed}</strong></div>
              <div className="harvest-actions">
                <button onClick={harvestNow} disabled={!wallet || daysLeft > 0}>Request Harvest</button>
              </div>
              <div className="airdrop-note">Genesis spore balance (per user): {AIRDROP_PER_USER} NOO</div>
            </div>
          </div>
        </section>

        <section className="feed">
          <h3>Recent Thoughts</h3>
          <div className="entries">
            {entries.length === 0 && <div className="empty">No seeds yet — be the first to post.</div>}
            {entries.map((e) => (
              <div className={'entry ' + (e.highlighted ? 'highlight' : '')} key={e.id}>
                <div className="entry-text">{e.text}</div>
                <div className="entry-meta">
                  <div>+{e.reward} NOO</div>
                  <div className="resonate">
                    <button onClick={async () => {
                      await supabase.from('posts').update({ resonates: (e.resonates || 0) + 1 }).eq('id', e.id);
                    }}>Resonate ({e.resonates || 0})</button>
                    <button onClick={async () => {
                      if (!wallet) return alert('Connect to sacrifice.');
                      const ok = confirm('Sacrifice 20 NOO to highlight this post? (mock)');
                      if (!ok) return;
                      const newBalance = await addOrUpdateBalance(wallet, -20);
                      setBalance(newBalance);
                      setEntries(entries.map(x => x.id === e.id ? { ...x, highlighted: true } : x));
                    }} className="burn">Sacrifice 20 NOO</button>
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
  );
}

