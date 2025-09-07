// Mock harvest API
// POST { wallet }
// If Supabase is configured, this endpoint will move unclaimed.amount -> balances.balance for the wallet.
// In production, replace with a scheduled job that batches on-chain transfers from treasury.
import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { wallet } = req.body
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' })

  try {
    if (supabase) {
      // fetch unclaimed
      const { data: uc } = await supabase.from('unclaimed').select('amount').eq('wallet', wallet).single()
      const amount = (uc && uc.amount) ? uc.amount : 0

      if (amount > 0) {
        // add to balances and clear unclaimed
        const { data: bal } = await supabase.from('balances').select('*').eq('wallet', wallet).single()
        if (bal) {
          const newBal = (bal.balance || 0) + amount
          await supabase.from('balances').update({ balance: newBal }).eq('wallet', wallet)
        } else {
          await supabase.from('balances').insert({ wallet, balance: amount })
        }
        await supabase.from('unclaimed').delete().eq('wallet', wallet)
      }
      return res.status(200).json({ ok: true, awarded: amount })
    } else {
      // localStorage not available server-side; instruct client to perform local move
      return res.status(200).json({ ok: false, error: 'Supabase not configured; run harvest client-side in demo' })
    }
  } catch (e) {
    console.error(e)
    return res.status(500).json({ ok: false, error: 'server error' })
  }
}