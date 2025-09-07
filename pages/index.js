import dynamic from 'next/dynamic'
import Head from 'next/head'
const Noospace = dynamic(() => import('../components/Noospace'), { ssr: false })

export default function Home() {
  return (
    <>
      <Head>
        <title>NooSpace — Mycelial Protocol</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <Noospace />
    </>
  )
}