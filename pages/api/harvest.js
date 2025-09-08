// pages/api/harvest.js
import { supabase } from '../../lib/supabaseClient'

const HARVEST_DAYS = 9 // Tage bis Harvest möglich

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { wallet } = req.body
  if (!wallet) return res.status(400).json({ error: 'Missing wallet' })

  try {
    // fetch unclaimed
    const { data: uc } = await supabase
      .from('unclaimed')
      .select('amount, created_at')
      .eq('wallet', wallet)
      .single()

    if (!uc || !uc.amount) return res.status(200).json({ ok: true, awarded: 0 })

    const now = new Date()
    const created = new Date(uc.created_at)
    const diffDays = (now - created) / (1000 * 60 * 60 * 24)

    if (diffDays < HARVEST_DAYS) {
      return res.status(400).json({ ok: false, error: `Harvest not ready. ${Math.ceil(HARVEST_DAYS - diffDays)} days left` })
    }

    const harvested = uc.amount

    // add to balance
    const { data: bal } = await supabase
      .from('balances')
      .select('balance')
      .eq('wallet', wallet)
      .single()

    if (bal) {
      await supabase.from('balances').update({ balance: (bal.balance || 0) + harvested }).eq('wallet', wallet)
    } else {
      await supabase.from('balances').insert({ wallet, balance: harvested })
    }

    // reset unclaimed
    await supabase.from('unclaimed').update({ amount: 0, created_at: now }).eq('wallet', wallet)

    return res.status(200).json({ ok: true, harvested })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ ok: false, error: 'server error' })
  }
}
