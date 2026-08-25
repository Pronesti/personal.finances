This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Phase 3 setup

**PDF upload** needs the Python pipeline's dependencies:

```bash
# from the repo root
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`resolvePython()` looks for `.venv/bin/python3`, or `TARJETAS_PYTHON` for a different interpreter.
Without either, `/upload` reports the setup command instead of failing obscurely. A superseded
statement's PDF is kept in `pdfs/.superseded/`.

**Merchant categorization** needs an Anthropic API key:

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> web/.env.local
```

Only merchant name strings are ever sent (spec §1, §7) — never amounts, dates, account numbers or
the cardholder name. Voucher and policy digit tails are stripped, and any merchant name that still
looks like money (the payment lines carry amounts and exchange rates in the description) is not
sent at all. Without a key, `/review` says so and everything else keeps working.
