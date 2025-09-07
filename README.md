NooSpace - McKenna-style Noosphere Prototype
===========================================

This prototype includes:
- Phantom wallet connect (UI simulation for local testing)
- Supabase client configured to read credentials from env vars:
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- Harvest UI with 9-day cycle, guest vs spore-bearer modes
- LocalStorage fallback when Supabase envs are not provided (safe for demo)

Deployment:
1. Add environment variables in Vercel:
   NEXT_PUBLIC_SUPABASE_URL = <your supabase url>
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <your anon key>
2. Install dependencies and run with `npm run dev` or deploy to Vercel.

Notes:
- This project uses a mock harvest payout flow. Actual on-chain SPL transfers need a backend job and a funded payout wallet.
- Code is written with McKenna-esque UI copy and ritual metaphors.

## Phantom & Harvest

To enable real Phantom connection and deploy:

1. Add env vars in Vercel: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SOLANA_NETWORK (optional), NEXT_PUBLIC_SOLANA_RPC_URL (optional)
2. Install wallet-adapter dependencies (already in package.json). During deployment make sure your hosting environment supports the wallet adapter.
3. Configure a backend job to perform on-chain SPL payouts from a funded treasury wallet — this project includes a mock /api/harvest endpoint that transfers unclaimed -> balance in Supabase.
